using Grana.Application.Common;
using Grana.Application.Finance;
using Grana.Domain.Common;
using Grana.Domain.Finance;

namespace Grana.Application.Tests.Finance;

/// <summary>categories.usecases.ts — RN-070–074, na ordem de checagens do Node.</summary>
public class CategoryUseCasesTests
{
    private static readonly DateTime Now = new(2026, 10, 26, 12, 0, 0, 123, DateTimeKind.Utc);
    private static readonly Actor Ana = new("u1", "ana@grana.app", "USER");

    private readonly InMemoryCategories _repository = new();
    private readonly FixedClock _clock = new(Now);
    private readonly CategoryUseCases _useCases;

    public CategoryUseCasesTests()
    {
        _useCases = new CategoryUseCases(_repository, _clock, new SequentialIds());
        _repository.Items.Add(Category.CreateSystem("mercado", "u1", "Mercado", "oklch(0.62 0.10 145)", CategoryKind.Expense));
        _repository.Items.Add(Category.CreateSystem("outro", "u2", "Mercado", "oklch(0.62 0.10 145)", CategoryKind.Expense));
    }

    [Fact]
    public async Task Lista_so_as_do_usuario_e_esconde_as_arquivadas()
    {
        var archived = Category.CreateCustom("velha", "u1", "Velha", CategoryKind.Expense, null, 0);
        archived.SetArchived(true, Now);
        _repository.Items.Add(archived);

        var visible = await _useCases.ListAsync(Ana, includeArchived: false, CancellationToken.None);
        Assert.Equal(["mercado"], visible.Select(c => c.Id));

        var all = await _useCases.ListAsync(Ana, includeArchived: true, CancellationToken.None);
        Assert.Equal(["mercado", "velha"], all.Select(c => c.Id));
        Assert.Equal(Now, all[1].ArchivedAt);
    }

    [Fact]
    public async Task Cria_com_a_cor_da_paleta_pelo_total_e_tipo_informado()
    {
        var created = await _useCases.CreateAsync(Ana, new CreateCategoryCommand("Pets", null, CategoryKind.Expense), CancellationToken.None);
        Assert.Equal(new CategoryDto("id-1", "Pets", "oklch(0.62 0.10 300)", "EXPENSE", false, null), created);

        var income = await _useCases.CreateAsync(Ana, new CreateCategoryCommand("Bico", "#123", CategoryKind.Income), CancellationToken.None);
        Assert.Equal(("INCOME", "#123"), (income.Kind, income.Color));
        Assert.Equal(4, _repository.Items.Count);
    }

    [Fact]
    public async Task Nome_repetido_no_mesmo_tipo_da_409_e_em_outro_tipo_passa()
    {
        var error = await Assert.ThrowsAsync<ConflictError>(() =>
            _useCases.CreateAsync(Ana, new CreateCategoryCommand("MERCADO", null, CategoryKind.Expense), CancellationToken.None));
        Assert.Equal("Você já tem uma categoria com esse nome.", error.Message);

        var other = await _useCases.CreateAsync(Ana, new CreateCategoryCommand("Mercado", null, CategoryKind.Income), CancellationToken.None);
        Assert.Equal("INCOME", other.Kind);
    }

    [Fact]
    public async Task Editar_inexistente_ou_de_outro_usuario_da_404()
    {
        var error = await Assert.ThrowsAsync<NotFoundError>(() =>
            _useCases.UpdateAsync(Ana, "outro", new UpdateCategoryCommand(Patch.Set("X"), default, default), CancellationToken.None));
        Assert.Equal("Categoria não encontrado.", error.Message);
    }

    [Fact]
    public async Task Renomear_so_em_maiusculas_nao_checa_repetido()
    {
        var updated = await _useCases.UpdateAsync(Ana, "mercado", new UpdateCategoryCommand(Patch.Set("MERCADO"), default, default), CancellationToken.None);
        Assert.Equal("MERCADO", updated.Name);
        Assert.Equal([("mercado", Now)], _repository.Updates);
    }

    [Fact]
    public async Task Renomear_para_nome_de_outra_categoria_da_409()
    {
        _repository.Items.Add(Category.CreateCustom("casa", "u1", "Casa", CategoryKind.Expense, null, 1));
        await Assert.ThrowsAsync<ConflictError>(() =>
            _useCases.UpdateAsync(Ana, "mercado", new UpdateCategoryCommand(Patch.Set("casa"), default, default), CancellationToken.None));
        Assert.Empty(_repository.Updates);
    }

    [Fact]
    public async Task Recolore_e_arquiva_com_o_instante_do_relogio()
    {
        var archived = await _useCases.UpdateAsync(
            Ana, "mercado", new UpdateCategoryCommand(default, Patch.Set("#000"), Patch.Set(true)), CancellationToken.None);
        Assert.Equal(("#000", (DateTime?)Now, "Mercado"), (archived.Color, archived.ArchivedAt, archived.Name));

        var restored = await _useCases.UpdateAsync(Ana, "mercado", new UpdateCategoryCommand(default, default, Patch.Set(false)), CancellationToken.None);
        Assert.Null(restored.ArchivedAt);
    }

    [Fact]
    public async Task Excluir_checa_existencia_uso_e_sistema_nessa_ordem()
    {
        await Assert.ThrowsAsync<NotFoundError>(() => _useCases.DeleteAsync(Ana, "nada", CancellationToken.None));

        _repository.Usages["mercado"] = 2;
        var inUse = await Assert.ThrowsAsync<BusinessRuleError>(() => _useCases.DeleteAsync(Ana, "mercado", CancellationToken.None));
        Assert.StartsWith("Esta categoria está em 2 registro(s).", inUse.Message);

        _repository.Usages.Clear();
        var system = await Assert.ThrowsAsync<BusinessRuleError>(() => _useCases.DeleteAsync(Ana, "mercado", CancellationToken.None));
        Assert.StartsWith("Categorias padrão", system.Message);

        _repository.Items.Add(Category.CreateCustom("temp", "u1", "Temp", CategoryKind.Expense, null, 2));
        await _useCases.DeleteAsync(Ana, "temp", CancellationToken.None);
        Assert.DoesNotContain(_repository.Items, c => c.Id == "temp");
    }
}
