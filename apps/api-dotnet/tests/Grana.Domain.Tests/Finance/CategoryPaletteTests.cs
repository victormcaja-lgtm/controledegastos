using Grana.Domain.Finance;

namespace Grana.Domain.Tests.Finance;

/// <summary>Paleta e categorias padrão — packages/shared/src/enums.ts e default-categories.ts.</summary>
public class CategoryPaletteTests
{
    [Fact]
    public void Paleta_tem_as_11_cores_do_app()
    {
        Assert.Equal(11, CategoryPalette.Colors.Count);
        Assert.Equal("oklch(0.62 0.10 145)", CategoryPalette.Colors[0]);
        Assert.Equal("oklch(0.62 0.10 90)", CategoryPalette.Colors[10]);
        Assert.Equal(11, CategoryPalette.Colors.Distinct().Count());
    }

    [Fact]
    public void Indice_negativo_e_recusado() =>
        Assert.Throws<ArgumentOutOfRangeException>(() => CategoryPalette.ColorForIndex(-1));

    [Fact]
    public void Padroes_sao_8_despesas_e_3_entradas_com_as_cores_da_paleta_em_ordem()
    {
        Assert.Equal(
            ["Mercado", "Lazer", "Roupa", "Transporte", "Casa", "Educação", "Assinaturas", "Dívidas", "Salário", "Renda extra", "Bônus"],
            CategoryPalette.Defaults.Select(c => c.Name));
        Assert.Equal(8, CategoryPalette.Defaults.Count(c => c.Kind == CategoryKind.Expense));
        Assert.Equal(CategoryPalette.Colors, CategoryPalette.Defaults.Select(c => c.Color));
    }

    [Fact]
    public void Despesa_vem_antes_de_entrada_na_ordem_do_enum() =>
        Assert.True(CategoryKind.Expense < CategoryKind.Income);
}
