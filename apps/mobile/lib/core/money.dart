/// Dinheiro é sempre representado em CENTAVOS (inteiro), como no resto do
/// Grana. A conversão para texto acontece só na borda de apresentação.
///
/// Espelha `packages/shared/src/money.ts` — mesma formatação que o site.
library;

const int centsInUnit = 100;

/// Arredondamento do `Math.round` do JavaScript (meio para +∞), para que as
/// conversões batam com o site centavo a centavo.
int jsRound(double value) => (value + 0.5).floorToDouble().toInt();

int toCents(double amount) => jsRound(amount * centsInUnit);

/// Lê uma entrada em pt-BR ("1.234,56", "1234,56", "1234.56", "-50") e devolve
/// centavos. Retorna `null` quando a entrada não é um número válido.
int? parseBRLToCents(String input) {
  final cleaned = input
      .trim()
      .replaceAll(RegExp(r'[R$\s ]'), '')
      .replaceAll(RegExp(r'\.(?=\d{3}(\D|$))'), '')
      .replaceFirst(',', '.');
  if (cleaned.isEmpty || !RegExp(r'^-?\d+(\.\d+)?$').hasMatch(cleaned)) return null;
  return toCents(double.parse(cleaned));
}

String _groupThousands(String digits) {
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// Formata centavos como moeda pt-BR: "R$ 1.234,56", "−R$ 10,00", "+R$ 5,00".
String formatMoney(
  int cents, {
  bool hideCents = false,
  bool withSymbol = true,
  bool signed = false,
}) {
  final absolute = cents.abs();
  String body;
  if (hideCents) {
    body = _groupThousands(jsRound(absolute / centsInUnit).toString());
  } else {
    final units = absolute ~/ centsInUnit;
    final rest = (absolute % centsInUnit).toString().padLeft(2, '0');
    body = '${_groupThousands(units.toString())},$rest';
  }
  final sign = cents < 0 ? '−' : (signed ? '+' : '');
  return '$sign${withSymbol ? 'R\$ ' : ''}$body';
}

/// Compacto para eixos de gráfico: "1,2k", "980".
String formatCompact(int cents) {
  final value = cents.abs() / centsInUnit;
  if (value >= 1000) {
    final rounded = jsRound(value / 100) / 10;
    final text = rounded == rounded.truncateToDouble()
        ? rounded.toInt().toString()
        : rounded.toString();
    return '${text.replaceAll('.', ',')}k';
  }
  return jsRound(value).toString();
}

/// Centavos para o texto editável de um campo em reais: 125000 → "1250,00".
String centsToInput(int cents) {
  final negative = cents < 0;
  final absolute = cents.abs();
  final text = '${absolute ~/ 100},${(absolute % 100).toString().padLeft(2, '0')}';
  return negative ? '-$text' : text;
}
