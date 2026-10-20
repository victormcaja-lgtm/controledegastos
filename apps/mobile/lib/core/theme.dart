import 'package:flutter/material.dart';

/// Design tokens do Grana — os mesmos de `apps/web/src/styles/globals.css`.
abstract final class GranaColors {
  static const cream = Color(0xFFEFEBE1);
  static const surface = Color(0xFFF6F3EC);
  static const card = Color(0xFFFFFDF7);
  static const ink = Color(0xFF14130F);
  static const inkSoft = Color(0xFF2E2C25);
  static const soft = Color(0xFF4A463D);
  static const muted = Color(0xFF8A8474);
  static const faint = Color(0xFFB6B0A2);
  static const line = Color(0xFFE5DFD1);
  static const lineSoft = Color(0xFFF0ECE1);
  static const chip = Color(0xFFEAE5DA);
  static const chipStrong = Color(0xFFE0DACB);
  static const stone = Color(0xFFB9B2A1);
  static const pebble = Color(0xFFC9C2B0);
  static const green = Color(0xFF5B7A6B);
  static const mint = Color(0xFF8FAE9C);
  static const clay = Color(0xFFC0704F);
}

abstract final class GranaRadius {
  static const card = 22.0;
  static const chip = 14.0;
}

/// Títulos e números grandes usam Archivo; o texto corrido, Figtree.
TextStyle display({
  double size = 15,
  FontWeight weight = FontWeight.w600,
  Color color = GranaColors.ink,
  double? letterSpacing,
  double? height,
}) =>
    TextStyle(
      fontFamily: 'Archivo',
      fontSize: size,
      fontWeight: weight,
      color: color,
      letterSpacing: letterSpacing,
      height: height,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

TextStyle body({
  double size = 14,
  FontWeight weight = FontWeight.w400,
  Color color = GranaColors.ink,
  double? height,
}) =>
    TextStyle(fontFamily: 'Figtree', fontSize: size, fontWeight: weight, color: color, height: height);

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: 'Figtree',
    scaffoldBackgroundColor: GranaColors.cream,
    colorScheme: ColorScheme.fromSeed(
      seedColor: GranaColors.green,
      primary: GranaColors.ink,
      onPrimary: GranaColors.surface,
      secondary: GranaColors.green,
      error: GranaColors.clay,
      surface: GranaColors.card,
    ),
  );

  return base.copyWith(
    textTheme: base.textTheme.apply(
      fontFamily: 'Figtree',
      bodyColor: GranaColors.ink,
      displayColor: GranaColors.ink,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: GranaColors.card,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
      hintStyle: body(color: GranaColors.faint),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GranaColors.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GranaColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GranaColors.green, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GranaColors.clay),
      ),
    ),
    dialogTheme: const DialogThemeData(backgroundColor: GranaColors.card),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
