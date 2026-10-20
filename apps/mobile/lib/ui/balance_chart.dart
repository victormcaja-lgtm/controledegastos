import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../core/dates.dart';
import '../core/money.dart';
import '../core/theme.dart';
import '../data/models.dart';

/// Linha do saldo: trecho real sólido, previsão tracejada, faixa abaixo de
/// zero quando o saldo fica negativo e um ponto no dia mais apertado.
/// Mesmo desenho do `BalanceChart` do site.
class BalanceChart extends StatelessWidget {
  const BalanceChart({
    super.key,
    required this.days,
    required this.today,
    this.compare,
    this.highlight,
    this.height = 120,
  });

  final List<BalancePoint> days;
  final String today;
  final List<BalancePoint>? compare;
  final BalancePoint? highlight;
  final double height;

  @override
  Widget build(BuildContext context) {
    if (days.length < 2) return const SizedBox.shrink();
    final todayIndex = days.indexWhere((day) => day.date.compareTo(today) >= 0);
    final first = days.first;
    final last = days.last;

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Semantics(
        label: 'Saldo de ${shortDate(first.date)} a ${shortDate(last.date)}: começa em '
            '${formatMoney(first.balanceCents)} e termina em ${formatMoney(last.balanceCents)}',
        child: Column(
          children: [
            SizedBox(
              height: height,
              width: double.infinity,
              child: CustomPaint(
                painter: _BalancePainter(days: days, todayIndex: todayIndex, compare: compare, highlight: highlight),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Text(shortDate(first.date), style: body(size: 11, color: GranaColors.muted)),
                const Spacer(),
                if (todayIndex > 0 && todayIndex < days.length - 1)
                  Text('hoje', style: body(size: 11, color: GranaColors.muted)),
                const Spacer(),
                Text(shortDate(last.date), style: body(size: 11, color: GranaColors.muted)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _BalancePainter extends CustomPainter {
  _BalancePainter({required this.days, required this.todayIndex, this.compare, this.highlight});

  final List<BalancePoint> days;
  final int todayIndex;
  final List<BalancePoint>? compare;
  final BalancePoint? highlight;

  @override
  void paint(Canvas canvas, Size size) {
    const pad = 8.0;
    final values = [...days, ...?compare].map((day) => day.balanceCents);
    final maxValue = math.max(values.reduce(math.max), 0);
    final minValue = math.min(values.reduce(math.min), 0);
    final span = math.max(maxValue - minValue, 1);

    final indexOf = {for (var i = 0; i < days.length; i++) days[i].date: i};
    double x(int index) => index / (days.length - 1) * size.width;
    double y(int cents) => pad + (maxValue - cents) / span * (size.height - pad * 2);

    Path pathOf(List<BalancePoint> points) {
      final path = Path();
      for (var i = 0; i < points.length; i++) {
        final point = Offset(x(indexOf[points[i].date] ?? i), y(points[i].balanceCents));
        i == 0 ? path.moveTo(point.dx, point.dy) : path.lineTo(point.dx, point.dy);
      }
      return path;
    }

    if (minValue < 0) {
      final zero = y(0);
      canvas.drawRect(
        Rect.fromLTRB(0, zero, size.width, size.height),
        Paint()..color = GranaColors.clay.withValues(alpha: 0.10),
      );
      _dashed(canvas, Path()..moveTo(0, zero)..lineTo(size.width, zero),
          Paint()..color = GranaColors.clay..strokeWidth = 1..style = PaintingStyle.stroke, 2, 3);
    }

    if (todayIndex > 0) {
      canvas.drawLine(
        Offset(x(todayIndex), 0),
        Offset(x(todayIndex), size.height),
        Paint()..color = GranaColors.line..strokeWidth = 1,
      );
    }

    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeJoin = StrokeJoin.round;

    final past = todayIndex == -1 ? days : days.sublist(0, todayIndex + 1);
    final future = todayIndex == -1 ? <BalancePoint>[] : days.sublist(math.max(0, todayIndex));

    canvas.drawPath(pathOf(past), stroke..color = GranaColors.ink);
    if (future.length > 1) {
      _dashed(canvas, pathOf(future), Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = GranaColors.green, 5, 4);
    }
    final compareDays = compare;
    if (compareDays != null && compareDays.length > 1) {
      canvas.drawPath(pathOf(compareDays), Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round
        ..color = GranaColors.clay);
    }

    final marker = highlight;
    if (marker != null && indexOf.containsKey(marker.date)) {
      final center = Offset(x(indexOf[marker.date]!), y(marker.balanceCents));
      canvas
        ..drawCircle(center, 6, Paint()..color = GranaColors.card)
        ..drawCircle(center, 4, Paint()..color = GranaColors.clay);
    }
  }

  void _dashed(Canvas canvas, Path path, Paint paint, double dash, double gap) {
    for (final ui.PathMetric metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + dash), paint);
        distance += dash + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant _BalancePainter old) =>
      old.days != days || old.compare != compare || old.highlight != highlight || old.todayIndex != todayIndex;
}
