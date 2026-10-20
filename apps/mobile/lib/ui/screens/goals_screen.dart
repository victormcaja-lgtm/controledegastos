import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/queries.dart';
import '../../application/session.dart';
import '../../core/money.dart';
import '../../core/theme.dart';
import '../../data/models.dart';
import '../widgets.dart';

const _quickAmounts = [5000, 10000, 25000];

/// Metas de poupança. O que se guarda sai do saldo no dia do depósito.
class GoalsScreen extends ConsumerStatefulWidget {
  const GoalsScreen({super.key});

  @override
  ConsumerState<GoalsScreen> createState() => _GoalsScreenState();
}

class _GoalsScreenState extends ConsumerState<GoalsScreen> {
  bool _formOpen = false;
  bool _depositing = false;
  final _name = TextEditingController();
  final _target = TextEditingController();
  bool _creating = false;

  @override
  void dispose() {
    _name.dispose();
    _target.dispose();
    super.dispose();
  }

  Future<void> _create(List<Goal> goals) async {
    final name = _name.text.trim();
    final target = parseBRLToCents(_target.text);
    if (name.length < 2) {
      showToast(context, 'Informe o nome.', error: true);
      return;
    }
    if (target == null || target <= 0) {
      showToast(context, 'O valor precisa ser maior que zero.', error: true);
      return;
    }
    setState(() => _creating = true);
    try {
      // A primeira meta vira a principal (o card escuro em destaque).
      await ref.read(granaApiProvider).createGoal(name: name, targetCents: target, featured: goals.isEmpty);
      if (!mounted) return;
      showToast(context, 'Meta criada');
      _name.clear();
      _target.clear();
      setState(() => _formOpen = false);
      ref.invalidate(goalsProvider);
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para criar a meta.');
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  Future<void> _deposit(Goal goal, int amount) async {
    setState(() => _depositing = true);
    try {
      await ref.read(granaApiProvider).depositToGoal(goal.id, amount);
      if (!mounted) return;
      showToast(context, 'Guardou ${formatMoney(amount)} em ${goal.name.toLowerCase()}');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para guardar.');
    } finally {
      if (mounted) setState(() => _depositing = false);
    }
  }

  Future<void> _delete(Goal goal) async {
    final confirmed = await confirmDialog(
      context,
      title: 'Excluir esta meta?',
      description: 'O histórico de depósitos também é apagado.',
      confirmLabel: 'Excluir',
      destructive: true,
    );
    if (!confirmed) return;
    try {
      await ref.read(granaApiProvider).deleteGoal(goal.id);
      if (!mounted) return;
      showToast(context, 'Meta removida');
      ref.invalidateMoney();
    } catch (error) {
      if (mounted) showErrorToast(context, error, 'Não deu para excluir.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final goals = ref.watch(goalsProvider);
    Future<void> reload() => ref.refresh(goalsProvider.future).then((_) {});

    return PageBody(
      onRefresh: reload,
      children: [
        const MoreTabs(current: '/guardar'),
        AsyncBody<List<Goal>>(value: goals, onRetry: reload, builder: _content),
      ],
    );
  }

  Widget _content(List<Goal> goals) {
    final totalSaved = goals.fold<int>(0, (sum, goal) => sum + goal.savedCents);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: 'Guardar', aside: Text('Guardado: ${formatMoney(totalSaved)}')),
        const SizedBox(height: 4),
        Text(
          'O que você guarda numa meta sai do seu saldo no dia do depósito.',
          style: body(size: 12, color: GranaColors.muted),
        ),
        gap14,
        GranaCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LinkText(_formOpen ? 'fechar' : '+ nova meta', onTap: () => setState(() => _formOpen = !_formOpen)),
              if (_formOpen) ...[
                gap12,
                LabeledField(
                  label: 'Nome da meta',
                  child: GranaInput(controller: _name, hint: 'Reserva de emergência'),
                ),
                gap12,
                LabeledField(
                  label: 'Objetivo (R\$)',
                  child: GranaInput(controller: _target, hint: '6000,00', keyboard: GranaInput.money),
                ),
                gap12,
                GranaButton(label: 'Criar meta', fullWidth: true, loading: _creating, onPressed: () => _create(goals)),
              ],
            ],
          ),
        ),
        gap14,
        if (goals.isEmpty)
          const EmptyState(
            title: 'Nenhuma meta ainda',
            description: 'Uma meta transforma sobra do mês em objetivo. Comece pela reserva de emergência.',
          )
        else
          for (final goal in goals)
            Padding(padding: const EdgeInsets.only(bottom: 14), child: _goalCard(goal)),
      ],
    );
  }

  Widget _goalCard(Goal goal) {
    final dark = goal.featured;
    final secondary = dark ? GranaColors.faint : GranaColors.muted;
    return GranaCard(
      dark: dark,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(goal.name, style: display(color: dark ? GranaColors.surface : GranaColors.ink)),
                    Text('objetivo ${formatMoney(goal.targetCents)}', style: body(size: 11.5, color: secondary)),
                  ],
                ),
              ),
              DeleteIconButton(tooltip: 'Excluir meta ${goal.name}', color: secondary, onPressed: () => _delete(goal)),
            ],
          ),
          gap12,
          MoneyText(
            goal.savedCents,
            style: display(size: 30, weight: FontWeight.w700, letterSpacing: -0.9, color: dark ? GranaColors.surface : GranaColors.ink),
          ),
          gap12,
          ProgressLine(
            percent: goal.progressPercent,
            color: dark ? GranaColors.mint : GranaColors.ink,
            track: dark ? GranaColors.inkSoft : GranaColors.lineSoft,
          ),
          gap8,
          Text(
            goal.achieved
                ? 'objetivo alcançado!'
                : 'faltam ${formatMoney(goal.remainingCents)} · ${goal.progressPercent}% do objetivo',
            style: body(size: 12.5, color: secondary),
          ),
          gap14,
          Row(
            children: [
              for (final amount in _quickAmounts)
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(right: amount == _quickAmounts.last ? 0 : 8),
                    child: Material(
                      color: dark ? GranaColors.inkSoft : GranaColors.lineSoft,
                      borderRadius: BorderRadius.circular(12),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: _depositing ? null : () => _deposit(goal, amount),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          child: Text(
                            '+ ${amount ~/ 100}',
                            textAlign: TextAlign.center,
                            style: body(size: 13, weight: FontWeight.w600, color: dark ? GranaColors.surface : GranaColors.ink),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
