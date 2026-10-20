import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../application/queries.dart';
import '../core/css_color.dart';
import '../core/dates.dart';
import '../core/money.dart';
import '../core/theme.dart';
import '../data/api_client.dart';

/// Componentes do Grana — equivalentes aos atoms e molecules do site.

/* ───────────────────────────── Feedback ─────────────────────────────── */

String errorMessage(Object error, String fallback) => error is ApiError ? error.message : fallback;

void showToast(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message, style: body(color: GranaColors.surface, size: 13.5)),
        backgroundColor: error ? GranaColors.clay : GranaColors.ink,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        duration: const Duration(milliseconds: 2600),
      ),
    );
}

void showErrorToast(BuildContext context, Object error, String fallback) =>
    showToast(context, errorMessage(error, fallback), error: true);

Future<bool> confirmDialog(
  BuildContext context, {
  required String title,
  String? description,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(GranaRadius.card)),
      title: Text(title, style: display(size: 17)),
      content: description == null ? null : Text(description, style: body(size: 13.5, color: GranaColors.soft)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text('Cancelar', style: body(color: GranaColors.soft, weight: FontWeight.w600)),
        ),
        GranaButton(
          label: confirmLabel,
          size: ButtonSize.sm,
          variant: destructive ? ButtonVariant.danger : ButtonVariant.primary,
          onPressed: () => Navigator.of(context).pop(true),
        ),
      ],
    ),
  );
  return result ?? false;
}

/// `hideCents` vem do ajuste "Arredondar centavos".
bool watchHideCents(WidgetRef ref) => ref.watch(settingsProvider).value?.roundCents ?? false;

/* ─────────────────────────────── Átomos ─────────────────────────────── */

class GranaCard extends StatelessWidget {
  const GranaCard({
    super.key,
    required this.child,
    this.dark = false,
    this.padding = const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
    this.borderColor,
    this.margin,
  });

  final Widget child;
  final bool dark;
  final EdgeInsetsGeometry padding;
  final Color? borderColor;
  final EdgeInsetsGeometry? margin;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        margin: margin,
        padding: padding,
        decoration: BoxDecoration(
          color: dark ? GranaColors.ink : GranaColors.card,
          borderRadius: BorderRadius.circular(GranaRadius.card),
          border: Border.all(color: borderColor ?? (dark ? GranaColors.ink : GranaColors.line)),
        ),
        child: DefaultTextStyle.merge(
          style: TextStyle(color: dark ? GranaColors.surface : GranaColors.ink),
          child: child,
        ),
      );
}

class MoneyText extends StatelessWidget {
  const MoneyText(this.cents, {super.key, this.hideCents = false, this.signed = false, this.style});

  final int cents;
  final bool hideCents;
  final bool signed;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) => Text(
        formatMoney(cents, hideCents: hideCents, signed: signed),
        style: (style ?? body()).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
      );
}

enum ButtonVariant { primary, secondary, ghost, danger }

enum ButtonSize { sm, md, lg }

class GranaButton extends StatelessWidget {
  const GranaButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = ButtonVariant.primary,
    this.size = ButtonSize.md,
    this.loading = false,
    this.fullWidth = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final ButtonVariant variant;
  final ButtonSize size;
  final bool loading;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    final (background, foreground, border) = switch (variant) {
      ButtonVariant.primary => (GranaColors.ink, GranaColors.surface, null),
      ButtonVariant.secondary => (GranaColors.card, GranaColors.ink, GranaColors.line),
      ButtonVariant.ghost => (Colors.transparent, GranaColors.soft, null),
      ButtonVariant.danger => (GranaColors.clay, Colors.white, null),
    };
    final (height, fontSize, radius, hPad) = switch (size) {
      ButtonSize.sm => (36.0, 13.0, 12.0, 12.0),
      ButtonSize.md => (44.0, 14.0, 16.0, 16.0),
      ButtonSize.lg => (56.0, 15.0, 16.0, 20.0),
    };
    final disabled = onPressed == null || loading;

    final button = Material(
      color: disabled && variant == ButtonVariant.primary ? GranaColors.stone : background,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(radius),
        side: border == null ? BorderSide.none : BorderSide(color: border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: disabled ? null : onPressed,
        child: Container(
          height: height,
          padding: EdgeInsets.symmetric(horizontal: hPad),
          // Só o botão de largura total centraliza; os demais têm o tamanho do texto.
          alignment: fullWidth ? Alignment.center : null,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (loading) ...[
                SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: foreground),
                ),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: body(size: fontSize, weight: FontWeight.w600, color: foreground),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    return fullWidth ? SizedBox(width: double.infinity, child: button) : button;
  }
}

class GranaChip extends StatelessWidget {
  const GranaChip({
    super.key,
    required this.label,
    this.selected = false,
    this.dotColor,
    this.dashed = false,
    this.onTap,
  });

  final String label;
  final bool selected;
  final String? dotColor;
  final bool dashed;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final background = dashed ? Colors.transparent : (selected ? GranaColors.ink : GranaColors.card);
    final border = dashed ? GranaColors.pebble : (selected ? GranaColors.ink : GranaColors.line);
    final foreground = dashed ? GranaColors.soft : (selected ? GranaColors.surface : GranaColors.ink);
    return Material(
      color: background,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(GranaRadius.chip),
        side: BorderSide(color: border),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(GranaRadius.chip),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (dotColor != null) ...[
                ColorDot(dotColor!, size: 9),
                const SizedBox(width: 7),
              ],
              Text(label, style: body(size: 13, weight: FontWeight.w500, color: foreground)),
            ],
          ),
        ),
      ),
    );
  }
}

class ColorDot extends StatelessWidget {
  const ColorDot(this.cssColor, {super.key, this.size = 10});

  final String cssColor;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: parseCssColor(cssColor), shape: BoxShape.circle),
      );
}

class ProgressLine extends StatelessWidget {
  const ProgressLine({
    super.key,
    required this.percent,
    this.height = 10,
    this.color = GranaColors.ink,
    this.track = GranaColors.lineSoft,
  });

  final num percent;
  final double height;
  final Color color;
  final Color track;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: Container(
          height: height,
          color: track,
          alignment: Alignment.centerLeft,
          child: FractionallySizedBox(
            widthFactor: (percent.clamp(0, 100)) / 100,
            child: Container(color: color),
          ),
        ),
      );
}

class LinkText extends StatelessWidget {
  const LinkText(this.label, {super.key, required this.onTap, this.size = 13});

  final String label;
  final VoidCallback onTap;
  final double size;

  @override
  Widget build(BuildContext context) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
          child: Text(label, style: body(size: size, weight: FontWeight.w500, color: GranaColors.green)),
        ),
      );
}

class DeleteIconButton extends StatelessWidget {
  const DeleteIconButton({super.key, required this.onPressed, required this.tooltip, this.color = GranaColors.muted});

  final VoidCallback onPressed;
  final String tooltip;
  final Color color;

  @override
  Widget build(BuildContext context) => IconButton(
        tooltip: tooltip,
        visualDensity: VisualDensity.compact,
        icon: Icon(Icons.close_rounded, size: 18, color: color),
        onPressed: onPressed,
      );
}

/* ───────────────────────────── Moléculas ────────────────────────────── */

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.aside});

  final String title;
  final Widget? aside;

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(child: Text(title, style: display())),
          if (aside != null)
            DefaultTextStyle.merge(style: body(size: 12, color: GranaColors.muted), child: aside!),
        ],
      );
}

class StatCard extends StatelessWidget {
  const StatCard({super.key, required this.label, required this.cents, this.hideCents = false, this.muted = false});

  final String label;
  final int cents;
  final bool hideCents;
  final bool muted;

  @override
  Widget build(BuildContext context) => Expanded(
        child: GranaCard(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: body(size: 12, color: GranaColors.muted)),
              const SizedBox(height: 3),
              FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerLeft,
                child: MoneyText(
                  cents,
                  hideCents: hideCents,
                  style: display(size: 20, letterSpacing: -0.4, color: muted ? GranaColors.muted : GranaColors.ink),
                ),
              ),
            ],
          ),
        ),
      );
}

class MonthSwitcher extends StatelessWidget {
  const MonthSwitcher({super.key, required this.month, required this.onChange, this.subtitle});

  final String month;
  final ValueChanged<String> onChange;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    Widget arrow(String glyph, String tooltip, int delta) => Tooltip(
          message: tooltip,
          child: Material(
            color: GranaColors.chip,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () => onChange(addMonths(month, delta)),
              child: SizedBox.square(
                dimension: 36,
                child: Center(child: Text(glyph, style: body(size: 17))),
              ),
            ),
          ),
        );

    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Row(
        children: [
          arrow('‹', 'Mês anterior', -1),
          Expanded(
            child: Column(
              children: [
                Text(monthLabel(month), style: display()),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      subtitle!,
                      textAlign: TextAlign.center,
                      style: body(size: 11, color: GranaColors.muted),
                    ),
                  ),
              ],
            ),
          ),
          arrow('›', 'Próximo mês', 1),
        ],
      ),
    );
  }
}

/// Rótulo + campo + dica/erro, como o `FormField` do site.
class LabeledField extends StatelessWidget {
  const LabeledField({super.key, required this.label, required this.child, this.hint, this.error});

  final String label;
  final Widget child;
  final String? hint;
  final String? error;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: body(size: 13, weight: FontWeight.w500, color: GranaColors.soft)),
          const SizedBox(height: 6),
          child,
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(error!, style: body(size: 11.5, weight: FontWeight.w500, color: GranaColors.clay)),
            )
          else if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(hint!, style: body(size: 11.5, color: GranaColors.muted)),
            ),
        ],
      );
}

/// Campo de texto do Grana, com os teclados certos para valor e número.
class GranaInput extends StatelessWidget {
  const GranaInput({
    super.key,
    this.controller,
    this.hint,
    this.keyboard = TextInputType.text,
    this.obscure = false,
    this.maxLength,
    this.autofocus = false,
    this.onChanged,
    this.onSubmitted,
    this.autofillHints,
  });

  /// Teclado para valores em reais (aceita vírgula e sinal de menos).
  static const money = TextInputType.numberWithOptions(decimal: true, signed: true);
  static const number = TextInputType.number;

  final TextEditingController? controller;
  final String? hint;
  final TextInputType keyboard;
  final bool obscure;
  final int? maxLength;
  final bool autofocus;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final Iterable<String>? autofillHints;

  @override
  Widget build(BuildContext context) => TextField(
        controller: controller,
        keyboardType: keyboard,
        obscureText: obscure,
        maxLength: maxLength,
        autofocus: autofocus,
        onChanged: onChanged,
        onSubmitted: onSubmitted,
        autofillHints: autofillHints,
        style: body(size: 14),
        decoration: InputDecoration(hintText: hint, counterText: ''),
      );
}

/// Seletor (o `<select>` do site).
class GranaSelect<T> extends StatelessWidget {
  const GranaSelect({super.key, required this.value, required this.items, required this.onChanged, this.hint});

  final T? value;
  final List<(T, String)> items;
  final ValueChanged<T?> onChanged;
  final String? hint;

  @override
  Widget build(BuildContext context) => DropdownButtonFormField<T>(
        initialValue: value,
        isExpanded: true,
        hint: hint == null ? null : Text(hint!, style: body(color: GranaColors.faint)),
        style: body(),
        dropdownColor: GranaColors.card,
        borderRadius: BorderRadius.circular(14),
        items: [
          for (final (itemValue, label) in items) DropdownMenuItem(value: itemValue, child: Text(label)),
        ],
        onChanged: onChanged,
      );
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.description});

  final String title;
  final String? description;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 12),
        child: Column(
          children: [
            Text(title, textAlign: TextAlign.center, style: display(size: 16)),
            if (description != null) ...[
              const SizedBox(height: 6),
              Text(
                description!,
                textAlign: TextAlign.center,
                style: body(size: 13, color: GranaColors.muted, height: 1.45),
              ),
            ],
          ],
        ),
      );
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: SizedBox.square(
            dimension: 26,
            child: CircularProgressIndicator(strokeWidth: 2.5, color: GranaColors.ink),
          ),
        ),
      );
}

/// Carregando → erro (com "tentar de novo") → conteúdo.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.builder, required this.onRetry});

  final AsyncValue<T> value;
  final Widget Function(T data) builder;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final data = value.value;
    if (data != null) return builder(data);
    if (value.hasError) {
      return Column(
        children: [
          EmptyState(
            title: 'Não deu para carregar',
            description: errorMessage(value.error!, 'Verifique sua conexão e tente de novo.'),
          ),
          GranaButton(label: 'Tentar de novo', variant: ButtonVariant.secondary, onPressed: onRetry),
        ],
      );
    }
    return const LoadingView();
  }
}

/// Caixinha de data (dia em cima, mês embaixo) das listas de vencimentos.
class DateBadge extends StatelessWidget {
  const DateBadge({super.key, required this.day, required this.month, this.alert = false});

  final String day;
  final String month;
  final bool alert;

  @override
  Widget build(BuildContext context) => Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: alert ? GranaColors.clay.withValues(alpha: 0.15) : GranaColors.lineSoft,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(day, style: display(size: 14, weight: FontWeight.w700, color: alert ? GranaColors.clay : GranaColors.ink, height: 1)),
            Text(
              month.toUpperCase(),
              style: body(size: 9, color: alert ? GranaColors.clay : GranaColors.muted),
            ),
          ],
        ),
      );
}

/// Linha de lista com divisória, como os `<li>` do site.
class ListRow extends StatelessWidget {
  const ListRow({super.key, required this.child, this.last = false, this.padding = const EdgeInsets.symmetric(vertical: 11)});

  final Widget child;
  final bool last;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          border: last ? null : const Border(bottom: BorderSide(color: GranaColors.lineSoft)),
        ),
        child: child,
      );
}

/// Corpo padrão de uma tela com rolagem e "puxar para atualizar".
class PageBody extends StatelessWidget {
  const PageBody({super.key, required this.children, this.onRefresh});

  final List<Widget> children;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 28),
      children: children,
    );
    return SafeArea(
      bottom: false,
      child: onRefresh == null
          ? list
          : RefreshIndicator(color: GranaColors.ink, onRefresh: onRefresh!, child: list),
    );
  }
}

class PageTitle extends StatelessWidget {
  const PageTitle(this.title, {super.key, this.trailing});

  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(child: Text(title, style: display(size: 22, weight: FontWeight.w700, letterSpacing: -0.4))),
            ?trailing,
          ],
        ),
      );
}

/// Sub-navegação das telas agrupadas em "Mais".
class MoreTabs extends StatelessWidget {
  const MoreTabs({super.key, required this.current});

  final String current;

  static const tabs = [
    ('/resultado', 'Resultado'),
    ('/cartoes', 'Cartões'),
    ('/mais', 'Categorias'),
    ('/parcelas', 'Parcelas'),
    ('/guardar', 'Guardar'),
    ('/ajustes', 'Ajustes'),
  ];

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final (path, label) in tabs)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GranaChip(
                    label: label,
                    selected: path == current,
                    onTap: () => context.go(path),
                  ),
                ),
            ],
          ),
        ),
      );
}

const gap8 = SizedBox(height: 8);
const gap12 = SizedBox(height: 12);
const gap14 = SizedBox(height: 14);
