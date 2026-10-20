using System.Reflection;
using NetArchTest.Rules;

namespace Grana.ArchitectureTests;

/// <summary>
/// Regra de dependência da Clean Architecture (plano.md §2.1):
/// Api → Application → Domain; Infrastructure → Application/Domain.
/// Se alguém violar, o build do CI quebra aqui.
/// </summary>
public class DependencyRulesTests
{
    private static readonly Assembly Domain = typeof(Domain.AssemblyMarker).Assembly;
    private static readonly Assembly Application = typeof(Application.AssemblyMarker).Assembly;
    private static readonly Assembly Infrastructure = typeof(Infrastructure.AssemblyMarker).Assembly;

    private static void AssertNoDependency(Assembly assembly, params string[] forbidden)
    {
        var result = Types.InAssembly(assembly).ShouldNot().HaveDependencyOnAny(forbidden).GetResult();
        Assert.True(
            result.IsSuccessful,
            $"{assembly.GetName().Name} depende de {string.Join(", ", forbidden)}: " +
            string.Join(", ", result.FailingTypeNames ?? []));
    }

    [Fact]
    public void Domain_nao_depende_de_nenhuma_outra_camada_nem_de_framework() =>
        AssertNoDependency(
            Domain,
            "Grana.Application",
            "Grana.Infrastructure",
            "Grana.Api",
            "Microsoft.EntityFrameworkCore",
            "Microsoft.AspNetCore",
            "Npgsql");

    [Fact]
    public void Application_nao_depende_de_infraestrutura_nem_de_http() =>
        AssertNoDependency(
            Application,
            "Grana.Infrastructure",
            "Grana.Api",
            "Microsoft.EntityFrameworkCore",
            "Microsoft.AspNetCore",
            "Npgsql");

    [Fact]
    public void Infrastructure_nao_depende_da_api() =>
        AssertNoDependency(Infrastructure, "Grana.Api", "Microsoft.AspNetCore");
}
