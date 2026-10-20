import 'dart:math' as math;

import 'package:flutter/painting.dart';

import 'theme.dart';

/// As categorias guardam a cor como CSS (`oklch(0.62 0.10 145)`, hex, `rgb()`
/// ou `hsl()`), porque o site usa a string direto no estilo. Aqui convertemos
/// para `Color`. Formato desconhecido cai no cinza neutro.
Color parseCssColor(String value) {
  final text = value.trim().toLowerCase();
  try {
    if (text.startsWith('#')) return _hex(text.substring(1));
    final args = RegExp(r'\(([^)]*)\)').firstMatch(text)?.group(1);
    if (args == null) return GranaColors.muted;
    final parts = args
        .split(RegExp(r'[\s,/]+'))
        .where((part) => part.isNotEmpty)
        .map((part) => part.endsWith('%') ? double.parse(part.substring(0, part.length - 1)) / 100 : double.parse(part.replaceAll('deg', '')))
        .toList();
    if (text.startsWith('oklch')) return _oklch(parts[0], parts[1], parts[2]);
    if (text.startsWith('rgb')) {
      final scale = args.contains('%') ? 255.0 : 1.0;
      return Color.fromARGB(255, (parts[0] * scale).round(), (parts[1] * scale).round(), (parts[2] * scale).round());
    }
    if (text.startsWith('hsl')) {
      return HSLColor.fromAHSL(1, parts[0] % 360, parts[1].clamp(0, 1), parts[2].clamp(0, 1)).toColor();
    }
  } catch (_) {
    // formato inesperado
  }
  return GranaColors.muted;
}

Color _hex(String digits) {
  final full = digits.length <= 4 ? digits.split('').map((c) => '$c$c').join() : digits;
  final rgb = int.parse(full.substring(0, 6), radix: 16);
  return Color(0xFF000000 | rgb);
}

/// OKLCH → OKLab → sRGB linear → sRGB (fórmulas de Björn Ottosson).
Color _oklch(double l, double c, double hueDegrees) {
  final h = hueDegrees * math.pi / 180;
  final a = c * math.cos(h);
  final b = c * math.sin(h);

  final l1 = math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3).toDouble();
  final m1 = math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3).toDouble();
  final s1 = math.pow(l - 0.0894841775 * a - 1.2914855480 * b, 3).toDouble();

  final r = 4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1;
  final g = -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1;
  final bl = -0.0041960863 * l1 - 0.7034186147 * m1 + 1.7076147010 * s1;

  int channel(double linear) {
    final v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * math.pow(linear, 1 / 2.4) - 0.055;
    return (v.clamp(0, 1) * 255).round();
  }

  return Color.fromARGB(255, channel(r), channel(g), channel(bl));
}
