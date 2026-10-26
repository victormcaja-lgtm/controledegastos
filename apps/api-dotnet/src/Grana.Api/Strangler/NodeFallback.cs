using Yarp.ReverseProxy.Configuration;

namespace Grana.Api.Strangler;

/// <summary>
/// Fachada do Strangler (plano.md §6): toda rota que o .NET ainda não atende
/// é repassada ao Node de forma TRANSPARENTE — corpo, status, cabeçalhos,
/// cookies e erros do jeito que o Node os produz.
/// </summary>
public static class NodeFallback
{
    private const string ClusterId = "node";

    public static IReverseProxyBuilder AddNodeFallback(this IServiceCollection services, string nodeUpstreamUrl)
    {
        var route = new RouteConfig
        {
            RouteId = "node-fallback",
            ClusterId = ClusterId,
            // Prioridade mínima: rotas nativas sempre ganham.
            Order = int.MaxValue,
            Match = new RouteMatch { Path = "{**catch-all}" },
        };
        var cluster = new ClusterConfig
        {
            ClusterId = ClusterId,
            Destinations = new Dictionary<string, DestinationConfig>
            {
                ["api-node"] = new() { Address = nodeUpstreamUrl },
            },
        };

        return services.AddReverseProxy()
            .LoadFromMemory([route], [cluster])
            .AddTransforms(context =>
            {
                // O Node confia em 1 salto (TRUST_PROXY_HOPS, RN-162/D-02): o cliente é o ÚLTIMO
                // valor do X-Forwarded-For, escrito pelo proxy da Railway. A fachada repassa o
                // cabeçalho INTACTO; acrescentar o próprio IP faria o Node ver a fachada como
                // cliente, e o padrão do YARP (substituir) apagaria o IP real.
                context.UseDefaultForwarders = false;
                // Host/Proto/Prefix encaminhados também ficam de fora: o Node não os usa.
                context.CopyRequestHeaders = true;
                context.CopyResponseHeaders = true;
            });
    }
}
