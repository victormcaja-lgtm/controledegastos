import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/dates.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

/// Tela de lançamento. O valor é digitado em CENTAVOS ("1250" vira R$ 12,50)
/// no teclado próprio — o gesto mais rápido para a ação mais repetida do dia.
class AddEntryScreen extends ConsumerStatefulWidget {
  const AddEntryScreen({super.key});

  @override
  ConsumerState<AddEntryScreen> createState() => _AddEntryScreenState();
}

class _AddEntryScreenState extends ConsumerState<AddEntryScreen> {
  String _type = 'EXPENSE';
  String _digits = '';
  final _note = TextEditingController();
  final _newCategory = TextEditingController();
  final Map<String, String?> _selected = {'EXPENSE': null, 'INCOME': null};
  bool _newCategoryOpen = false;
  bool _creatingCategory = false;
  bool _saving = false;

  /// `null` = saiu da conta; senão, o id do cartão.
  String? _cardId;
  int _installments = 1;

  int get _cents => int.parse(_digits.isEmpty ? '0' : _digits);
  bool get _payingWithCard => _type == 'EXPENSE' && _cardId != null;

  @override
  void dispose() {
    _note.dispose();
    _newCategory.dispose();
    super.dispose();
  }

  void _press(String key) {
    setState(() {
      if (key == 'del') {
        if (_digits.isNotEmpty) _digits = _digits.substring(0, _digits.length - 1);
      } else if (_digits.length < 8) {
        _digits = (_digits + key).replaceFirst(RegExp(r'^0+(?=\d)'), '');
      }
    });
  }

  Future<void> _createCategory() async {
    final name = _newCategory.text.trim();
    if (name.length < 2) {
      showToast(context, 'Dê um nome de pelo menos 2 letras.', error: true);
      return;
    }
    setState(() => _creatingCategory = true);
    try {
      final created = await ref.read(granaApiProvider).createCategory(name: name, kind: _type);
      ref.invalidate(categoriesProvider);
      if (!mounted) return;
      setState(() {
        _selected[_type] = created.id;
        _newCategoryOpen = false;
        _newCategory.clear();
      });
      showToast(context, 'Categoria ${created.name} criada');
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para criar.');
    } finally {
      if (mounted) setState(() => _creatingCategory = false);
    }
  }

  Future<void> _save(String? categoryId) async {
    final cents = _cents;
    if (cents == 0) {
      showToast(context, 'Digite um valor primeiro.', error: true);
      return;
    }
    if (categoryId == null) {
      showToast(context, 'Escolha uma categoria.', error: true);
      return;
    }
    final api = ref.read(granaApiProvider);
    setState(() => _saving = true);
    try {
      if (_payingWithCard) {
        // No cartão, o dinheiro sai na fatura — não vira lançamento do dia.
        await api.createCardPurchase(
          _cardId!,
          amountCents: cents,
          installments: _installments,
          purchasedOn: localTodayISO(),
          categoryId: categoryId,
          note: _note.text,
        );
        if (!mounted) return;
        showToast(
          context,
          'Compra de ${formatMoney(cents)} no cartão${_installments > 1 ? ' em ${_installments}x' : ''} salva',
        );
      } else {
        await api.createTransaction(
          type: _type,
          amountCents: cents,
          categoryId: categoryId,
          occurredOn: localTodayISO(),
          note: _note.text,
        );
        if (!mounted) return;
        showToast(context, '${_type == 'INCOME' ? 'Entrada' : 'Gasto'} de ${formatMoney(cents)} salvo');
      }
      ref.invalidateMoney();
      context.canPop() ? context.pop() : context.go('/');
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para salvar.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider);
    final cards = ref.watch(cardsProvider).value ?? const <CreditCard>[];
    final activeCards = cards.where((card) => card.active).toList();

    return Scaffold(
      body: SafeArea(
        child: categories.value == null
            ? AsyncBody(value: categories, onRetry: () => ref.invalidate(categoriesProvider), builder: (_) => const SizedBox())
            : _form(categories.value!, activeCards),
      ),
    );
  }

  Widget _form(List<Category> categories, List<CreditCard> activeCards) {
    final visible = categories.where((c) => c.kind == _type && !c.archived).toList();
    final selectedId = _selected[_type] ?? visible.firstOrNull?.id;
    final selected = visible.where((c) => c.id == selectedId).firstOrNull;
    final cents = _cents;

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.only(bottom: 8),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 12, 20, 0),
                child: Row(
                  children: [
                    TextButton(
                      onPressed: () => context.canPop() ? context.pop() : context.go('/'),
                      child: Text('Cancelar', style: body(color: GranaColors.muted)),
                    ),
                    const Spacer(),
                    _TypeSwitch(
                      value: _type,
                      onChanged: (type) => setState(() => _type = type),
                    ),
                    const Spacer(),
                    const SizedBox(width: 64),
                  ],
                ),
              ),
              const SizedBox(height: 28),
              Text(
                '${_type == 'INCOME' ? 'Quanto entrou' : 'Quanto gastou'}'
                '${selected == null ? '' : ' em ${selected.name.toLowerCase()}'}',
                textAlign: TextAlign.center,
                style: body(size: 13, color: GranaColors.muted),
              ),
              const SizedBox(height: 6),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    formatMoney(cents),
                    style: display(
                      size: 54,
                      weight: FontWeight.w700,
                      letterSpacing: -2,
                      color: _type == 'INCOME' ? GranaColors.green : GranaColors.ink,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final category in visible)
                      GranaChip(
                        label: category.name,
                        dotColor: category.color,
                        selected: category.id == selectedId,
                        onTap: () => setState(() => _selected[_type] = category.id),
                      ),
                    GranaChip(
                      label: '+ Nova categoria',
                      dashed: true,
                      onTap: () => setState(() => _newCategoryOpen = !_newCategoryOpen),
                    ),
                  ],
                ),
              ),
              if (_newCategoryOpen)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                  child: Row(
                    children: [
                      Expanded(
                        child: GranaInput(controller: _newCategory, hint: 'Nome da categoria', maxLength: 60),
                      ),
                      const SizedBox(width: 8),
                      GranaButton(label: 'Criar', loading: _creatingCategory, onPressed: _createCategory),
                    ],
                  ),
                ),
              if (_type == 'EXPENSE' && activeCards.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Pagou com', style: body(size: 12, weight: FontWeight.w500, color: GranaColors.muted)),
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          GranaChip(
                            label: 'Conta / Pix',
                            selected: _cardId == null,
                            onTap: () => setState(() => _cardId = null),
                          ),
                          for (final card in activeCards)
                            GranaChip(
                              label: card.name,
                              selected: _cardId == card.id,
                              onTap: () => setState(() => _cardId = card.id),
                            ),
                        ],
                      ),
                      if (_payingWithCard)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: _InstallmentsStepper(
                            value: _installments,
                            onChanged: (value) => setState(() => _installments = value),
                          ),
                        ),
                    ],
                  ),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: GranaInput(controller: _note, hint: 'Observação (opcional)', maxLength: 140),
              ),
              _Keypad(onPress: _press),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: GranaButton(
            label: cents > 0 ? 'Salvar ${formatMoney(cents)}' : 'Digite o valor',
            size: ButtonSize.lg,
            fullWidth: true,
            loading: _saving,
            onPressed: cents > 0 ? () => _save(selectedId) : null,
          ),
        ),
      ],
    );
  }
}

class _TypeSwitch extends StatelessWidget {
  const _TypeSwitch({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(color: GranaColors.chip, borderRadius: BorderRadius.circular(12)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final (type, label) in [('EXPENSE', 'Saiu'), ('INCOME', 'Entrou')])
              GestureDetector(
                onTap: () => onChanged(type),
                child: Semantics(
                  selected: value == type,
                  button: true,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
                    decoration: BoxDecoration(
                      color: value == type ? GranaColors.card : Colors.transparent,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      label,
                      style: body(
                        size: 13,
                        weight: FontWeight.w600,
                        color: value == type ? GranaColors.ink : GranaColors.muted,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      );
}

class _InstallmentsStepper extends StatelessWidget {
  const _InstallmentsStepper({required this.value, required this.onChanged});

  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Text('Parcelas', style: body(size: 13, color: GranaColors.soft)),
          const Spacer(),
          IconButton(
            tooltip: 'Menos parcelas',
            onPressed: value > 1 ? () => onChanged(value - 1) : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          SizedBox(width: 36, child: Text('${value}x', textAlign: TextAlign.center, style: display())),
          IconButton(
            tooltip: 'Mais parcelas',
            onPressed: value < 48 ? () => onChanged(value + 1) : null,
            icon: const Icon(Icons.add_circle_outline),
          ),
        ],
      );
}

/// Teclado numérico do lançamento. Digita-se em centavos: "1250" = R$ 12,50.
class _Keypad extends StatelessWidget {
  const _Keypad({required this.onPress});

  final ValueChanged<String> onPress;

  static const _keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'];

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        child: GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 2.3,
          children: [
            for (final key in _keys)
              Material(
                color: GranaColors.card,
                borderRadius: BorderRadius.circular(16),
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: () => onPress(key),
                  child: Center(
                    child: key == 'del'
                        ? const Icon(Icons.backspace_outlined, size: 20, semanticLabel: 'Apagar último dígito')
                        : Text(key, style: display(size: 20, weight: FontWeight.w500)),
                  ),
                ),
              ),
          ],
        ),
      );
}
