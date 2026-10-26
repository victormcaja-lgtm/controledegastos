using System.Collections.Concurrent;
using System.Globalization;

namespace Grana.Api.Http;

/// <summary>Endpoint fora do rate limit global (<c>config: { rateLimit: false }</c>, ex.: <c>/health</c>).</summary>
public sealed class NoRateLimitMetadata;

/// <summary>
/// Rate limit global por IP — o <c>LocalStore</c> do <c>@fastify/rate-limit</c>: janela
/// FIXA que começa na primeira requisição; o contador zera quando a janela vence.
/// Conta toda requisição, inclusive as que terminam em 400 ou 401 (o plugin roda no
/// <c>onRequest</c>, antes da validação e da autenticação). Fica em memória, como no
/// Node: durante a migração, Node e .NET contam separadamente (plano.md §6.1).
/// </summary>
public sealed class RateLimiter(int max, TimeSpan window, TimeProvider time)
{
    private const int CleanupThreshold = 10_000;

    private readonly ConcurrentDictionary<string, Counter> _counters = new(StringComparer.Ordinal);

    public int Max => max;

    /// <summary>Registra uma requisição de <paramref name="key"/> e diz se ela passa.</summary>
    public Decision Hit(string key)
    {
        var now = time.GetUtcNow().ToUnixTimeMilliseconds();
        var windowMs = (long)window.TotalMilliseconds;
        if (_counters.Count > CleanupThreshold) RemoveExpired(now, windowMs);

        var counter = _counters.GetOrAdd(key, _ => new Counter(now));
        lock (counter)
        {
            if (counter.StartMs + windowMs <= now)
            {
                counter.StartMs = now;
                counter.Count = 0;
            }

            counter.Count += 1;
            var ttlMs = windowMs - (now - counter.StartMs);
            return new Decision(counter.Count <= max, Math.Max(0, max - counter.Count), (int)Math.Ceiling(ttlMs / 1000.0));
        }
    }

    private void RemoveExpired(long now, long windowMs)
    {
        foreach (var (key, counter) in _counters)
        {
            if (counter.StartMs + windowMs <= now) _counters.TryRemove(key, out _);
        }
    }

    private sealed class Counter(long startMs)
    {
        public long StartMs { get; set; } = startMs;

        public int Count { get; set; }
    }

    /// <param name="Allowed">Dentro do limite.</param>
    /// <param name="Remaining">Quantas ainda cabem na janela.</param>
    /// <param name="ResetSeconds">Segundos até a janela vencer, arredondados para cima.</param>
    public sealed record Decision(bool Allowed, int Remaining, int ResetSeconds)
    {
        /// <summary>Cabeçalhos <c>x-ratelimit-*</c> (e <c>retry-after</c> no 429), como o plugin.</summary>
        public void WriteHeaders(IHeaderDictionary headers, int max)
        {
            ArgumentNullException.ThrowIfNull(headers);
            headers["x-ratelimit-limit"] = max.ToString(CultureInfo.InvariantCulture);
            headers["x-ratelimit-remaining"] = Remaining.ToString(CultureInfo.InvariantCulture);
            headers["x-ratelimit-reset"] = ResetSeconds.ToString(CultureInfo.InvariantCulture);
            if (!Allowed) headers.RetryAfter = ResetSeconds.ToString(CultureInfo.InvariantCulture);
        }

        public HttpError ToError() =>
            new(429, "Error", "RATE_LIMITED", $"Muitas requisições. Tente de novo em {ResetSeconds}s.");
    }
}

/// <summary>
/// IP do cliente com <c>trustProxy: (_, hop) =&gt; hop &lt; TRUST_PROXY_HOPS</c> do Fastify
/// (proxy-addr): a partir do socket, anda pelo <c>X-Forwarded-For</c> da DIREITA para a
/// esquerda pulando os saltos confiáveis. Com 1 salto, o cliente é o último valor da
/// lista, escrito pelo proxy da Railway; o que o cliente põe à esquerda é ignorado (RN-162).
/// </summary>
public static class ClientIp
{
    public static string Resolve(string socketAddress, string? forwardedFor, int trustedHops)
    {
        var chain = new List<string> { socketAddress };
        if (!string.IsNullOrEmpty(forwardedFor))
        {
            var entries = forwardedFor.Split(',').Select(entry => entry.Trim(' ', '\t')).ToList();
            entries.Reverse();
            chain.AddRange(entries);
        }

        return chain[Math.Min(trustedHops, chain.Count - 1)];
    }

    public static string Of(HttpContext context, int trustedHops)
    {
        ArgumentNullException.ThrowIfNull(context);
        var socket = context.Connection.RemoteIpAddress;
        var address = socket is null ? string.Empty : (socket.IsIPv4MappedToIPv6 ? socket.MapToIPv4() : socket).ToString();
        return Resolve(address, context.Request.Headers["x-forwarded-for"].ToString(), trustedHops);
    }
}
