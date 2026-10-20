using Yarp.ReverseProxy.Configuration;
using Yarp.ReverseProxy.Transforms;

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
                // O Node identifica o cliente pelo X-Forwarded-For MAIS À ESQUERDA (RN-162 ⚠️).
                // ACRESCENTAR o salto da fachada mantém o mesmo IP que ele vê hoje; o padrão
                // do YARP (substituir) faria todos os usuários parecerem o mesmo IP.
                context.UseDefaultForwarders = false;
                context.AddXForwardedFor(action: ForwardedTransformActions.Append);
                // O Node não usa Host/Proto/Prefix encaminhados; não mexer neles evita surpresas.
                context.CopyRequestHeaders = true;
                context.CopyResponseHeaders = true;
            });
    }
}
