using Microsoft.AspNetCore.Routing.Matching;
using Microsoft.AspNetCore.Routing.Patterns;

namespace Grana.Api.Http;

/// <summary>
/// O roteador do ASP.NET ignora maiúsculas e a barra final; o do Fastify (find-my-way)
/// não: <c>/API/settings</c> e <c>/api/settings/</c> dão 404 no Node. Esta política
/// descarta a rota nativa nesses casos, e a requisição cai no repasse ao Node, que
/// responde o 404 dele (RN-012).
/// </summary>
public sealed class ExactPathPolicy : MatcherPolicy, IEndpointSelectorPolicy
{
    // Depois das políticas padrão (método HTTP etc.).
    public override int Order => 1_000;

    public bool AppliesToEndpoints(IReadOnlyList<Endpoint> endpoints) =>
        endpoints.Any(endpoint => endpoint.Metadata.GetMetadata<NativeEndpointMetadata>() is not null);

    public Task ApplyAsync(HttpContext httpContext, CandidateSet candidates)
    {
        ArgumentNullException.ThrowIfNull(httpContext);
        ArgumentNullException.ThrowIfNull(candidates);
        var path = httpContext.Request.Path.Value ?? string.Empty;
        for (var index = 0; index < candidates.Count; index++)
        {
            if (!candidates.IsValidCandidate(index)) continue;
            if (candidates[index].Endpoint is not RouteEndpoint { } endpoint) continue;
            if (endpoint.Metadata.GetMetadata<NativeEndpointMetadata>() is null) continue;
            if (!Matches(endpoint.RoutePattern, path)) candidates.SetValidity(index, false);
        }

        return Task.CompletedTask;
    }

    /// <summary>Mesma quantidade de segmentos e literais iguais, diferenciando maiúsculas.</summary>
    public static bool Matches(RoutePattern pattern, string path)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        ArgumentNullException.ThrowIfNull(path);
        var segments = path.Split('/')[1..];
        if (segments.Length != pattern.PathSegments.Count) return false;
        for (var index = 0; index < segments.Length; index++)
        {
            var parts = pattern.PathSegments[index].Parts;
            if (parts is [RoutePatternLiteralPart literal])
            {
                if (!string.Equals(literal.Content, segments[index], StringComparison.Ordinal)) return false;
            }
            else if (segments[index].Length == 0)
            {
                return false;
            }
        }

        return true;
    }
}
