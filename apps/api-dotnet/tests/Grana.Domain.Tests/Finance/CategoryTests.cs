using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Categorias — RN-070–074 (categories.usecases.ts).</summary>
public class CategoryTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 13, 45, 12, 345, DateTimeKind.Utc);

    private static Category Custom(string name = "Pets", string? color = null, int existing = 0) =>
        Category.CreateCustom("c1", "u1", name, CategoryKind.Expense, color, existing);

    [Fact]
    public void Personalizada_nasce_ativa_e_fora_do_sistema()
    {
        var category = Custom(color: "#123456");
        Assert.Equal("c1", category.Id);
        Assert.Equal("u1", category.UserId);
        Assert.Equal("Pets", category.Name);
        Assert.Equal("#123456", category.Color);
        Assert.Equal(CategoryKind.Expense, category.Kind);
        Assert.False(category.IsSystem);
        Assert.Null(category.ArchivedAt);
        Assert.False(category.IsArchived);
    }

    [Theory]
    [InlineData(0, "oklch(0.62 0.10 145)")]
    [InlineData(10, "oklch(0.62 0.10 90)")]
    [InlineData(11, "oklch(0.62 0.10 145)")]
    [InlineData(25, "oklch(0.62 0.10 70)")]
    public void Sem_cor_usa_a_paleta_pelo_total_de_categorias(int existing, string expected) =>
        Assert.Equal(expected, Custom(existing: existing).Color);

    [Fact]
    public void Do_sistema_vem_marcada()
    {
        var category = Category.CreateSystem("c2", "u1", "Salário", "oklch(0.62 0.10 160)", CategoryKind.Income);
        Assert.True(category.IsSystem);
        Assert.Equal(CategoryKind.Income, category.Kind);
        Assert.Null(category.ArchivedAt);
    }

    [Theory]
    [InlineData("Pets", false)]
    [InlineData("PETS", false)]
    [InlineData("pets", false)]
    [InlineData("Pet", true)]
    [InlineData("Pets ", true)]
    [InlineData("Educação", true)]
    public void Checagem_de_repetido_so_quando_o_nome_muda_alem_de_maiusculas(string newName, bool expected) =>
        Assert.Equal(expected, Custom().NeedsDuplicateCheckFor(newName));

    [Fact]
    public void Maiusculas_acentuadas_contam_como_o_mesmo_nome() =>
        Assert.False(Custom("Educação").NeedsDuplicateCheckFor("EDUCAÇÃO"));

    [Fact]
    public void Renomeia_e_troca_a_cor()
    {
        var category = Custom();
        category.Rename("Bichos");
        category.ChangeColor("oklch(0.62 0.10 70)");
        Assert.Equal("Bichos", category.Name);
        Assert.Equal("oklch(0.62 0.10 70)", category.Color);
    }

    [Fact]
    public void Arquivar_grava_o_instante_e_arquivar_de_novo_atualiza()
    {
        var category = Custom();
        category.SetArchived(true, Now);
        Assert.Equal(Now, category.ArchivedAt);
        Assert.True(category.IsArchived);

        var later = Now.AddMinutes(5);
        category.SetArchived(true, later);
        Assert.Equal(later, category.ArchivedAt);

        category.SetArchived(false, later);
        Assert.Null(category.ArchivedAt);
    }

    [Fact]
    public void Do_sistema_pode_ser_arquivada()
    {
        var category = Category.CreateSystem("c2", "u1", "Mercado", "x", CategoryKind.Expense);
        category.SetArchived(true, Now);
        Assert.Equal(Now, category.ArchivedAt);
    }

    [Fact]
    public void Sem_uso_e_personalizada_pode_ser_excluida() =>
        Custom().EnsureCanBeDeleted(0);

    [Fact]
    public void Em_uso_nao_pode_ser_excluida()
    {
        var error = Assert.Throws<BusinessRuleError>(() => Custom().EnsureCanBeDeleted(3));
        Assert.Equal("Esta categoria está em 3 registro(s). Arquive-a em vez de excluir.", error.Message);
        Assert.Equal("BUSINESS_RULE", error.Code);
    }

    [Fact]
    public void Do_sistema_nao_pode_ser_excluida()
    {
        var category = Category.CreateSystem("c2", "u1", "Mercado", "x", CategoryKind.Expense);
        var error = Assert.Throws<BusinessRuleError>(() => category.EnsureCanBeDeleted(0));
        Assert.Equal("Categorias padrão não podem ser excluídas — apenas arquivadas.", error.Message);
    }

    [Fact]
    public void Uso_e_checado_antes_da_regra_do_sistema()
    {
        var category = Category.CreateSystem("c2", "u1", "Mercado", "x", CategoryKind.Expense);
        var error = Assert.Throws<BusinessRuleError>(() => category.EnsureCanBeDeleted(1));
        Assert.StartsWith("Esta categoria está em 1 registro(s).", error.Message);
    }

    [Fact]
    public void Restore_preserva_o_estado_do_banco()
    {
        var category = Category.Restore("c3", "u2", "Bônus", "y", CategoryKind.Income, isSystem: true, archivedAt: Now);
        Assert.Equal(("c3", "u2", "Bônus", "y", CategoryKind.Income, true, (DateTime?)Now),
            (category.Id, category.UserId, category.Name, category.Color, category.Kind, category.IsSystem, category.ArchivedAt));
    }
}
