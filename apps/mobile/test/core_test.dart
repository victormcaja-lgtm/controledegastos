import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:grana_mobile/core/css_color.dart';
import 'package:grana_mobile/core/dates.dart';
import 'package:grana_mobile/core/money.dart';

/// Os valores esperados foram gerados executando `packages/shared/src/money.ts`
/// e `month.ts` no Node: o app precisa mostrar exatamente o que o site mostra.
void main() {
  group('formatMoney (igual ao site)', () {
    const cases = [
      (0, 'R\$ 0,00', 'R\$ 0', '+R\$ 0,00'),
      (5, 'R\$ 0,05', 'R\$ 0', '+R\$ 0,05'),
      (99, 'R\$ 0,99', 'R\$ 1', '+R\$ 0,99'),
      (100, 'R\$ 1,00', 'R\$ 1', '+R\$ 1,00'),
      (123456, 'R\$ 1.234,56', 'R\$ 1.235', '+R\$ 1.234,56'),
      (-1000, '−R\$ 10,00', '−R\$ 10', '−R\$ 10,00'),
      (100000000, 'R\$ 1.000.000,00', 'R\$ 1.000.000', '+R\$ 1.000.000,00'),
      (214900, 'R\$ 2.149,00', 'R\$ 2.149', '+R\$ 2.149,00'),
      (-50, '−R\$ 0,50', '−R\$ 1', '−R\$ 0,50'),
      (1999999999, 'R\$ 19.999.999,99', 'R\$ 20.000.000', '+R\$ 19.999.999,99'),
      (150, 'R\$ 1,50', 'R\$ 2', '+R\$ 1,50'),
    ];
    for (final (cents, plain, hidden, signed) in cases) {
      test('$cents', () {
        expect(formatMoney(cents), plain);
        expect(formatMoney(cents, hideCents: true), hidden);
        expect(formatMoney(cents, signed: true), signed);
      });
    }
  });

  test('formatCompact (igual ao site)', () {
    const cases = {0: '0', 98000: '980', 99999: '1000', 100000: '1k', 123456: '1,2k', 1250000: '12,5k', 99950: '1000'};
    cases.forEach((cents, expected) => expect(formatCompact(cents), expected, reason: '$cents'));
  });

  test('parseBRLToCents (igual ao site)', () {
    const cases = <String, int?>{
      '1.234,56': 123456,
      '1234,56': 123456,
      '1234.56': 123456,
      '-50': -5000,
      'R\$ 12,5': 1250,
      'abc': null,
      '': null,
      '1.000': 100000,
      '10.5.5': null,
      '0,005': 1,
    };
    cases.forEach((input, expected) => expect(parseBRLToCents(input), expected, reason: input));
  });

  test('centsToInput volta para o formato do campo', () {
    expect(centsToInput(125000), '1250,00');
    expect(centsToInput(-5), '-0,05');
    expect(parseBRLToCents(centsToInput(-123456)), -123456);
  });

  group('datas e competências', () {
    test('addMonths (igual ao site)', () {
      expect(addMonths('2026-01', -1), '2025-12');
      expect(addMonths('2026-12', 1), '2027-01');
      expect(addMonths('2026-03', -15), '2024-12');
      expect(addMonths('2025-11', 14), '2027-01');
    });

    test('monthLabel', () {
      expect(monthLabel('2026-03'), 'Março 2026');
      expect(monthNameShort('2026-10'), 'out');
    });

    test('addDaysISO e lastDayOfMonthISO atravessam meses e anos', () {
      expect(addDaysISO('2026-12-31', 1), '2027-01-01');
      expect(addDaysISO('2026-03-01', -1), '2026-02-28');
      expect(lastDayOfMonthISO('2028-02-10'), '2028-02-29');
    });

    test('dayLabel', () {
      expect(dayLabel('2026-10-19', '2026-10-19'), 'Hoje');
      expect(dayLabel('2026-10-20', '2026-10-19'), 'Amanhã');
      expect(dayLabel('2026-10-18', '2026-10-19'), 'Ontem');
      expect(dayLabel('2026-10-15', '2026-10-19'), 'qui, 15 de outubro');
    });

    test('localTodayISO usa o fuso do aparelho', () {
      expect(localTodayISO(DateTime(2026, 1, 5, 23, 59)), '2026-01-05');
    });
  });

  group('cores das categorias', () {
    test('hex curto e longo', () {
      expect(parseCssColor('#fff'), const Color(0xFFFFFFFF));
      expect(parseCssColor('#5b7a6b'), const Color(0xFF5B7A6B));
    });

    test('oklch vira uma cor sRGB plausível', () {
      // oklch(0.62 0.10 145) é o verde de "Mercado": verde domina.
      final color = parseCssColor('oklch(0.62 0.10 145)');
      expect(color.g, greaterThan(color.r));
      expect(color.g, greaterThan(color.b));
      // L=0.5, C=0 é cinza neutro.
      final gray = parseCssColor('oklch(0.5 0 0)');
      expect((gray.r - gray.g).abs(), lessThan(0.01));
      expect((gray.g - gray.b).abs(), lessThan(0.01));
    });

    test('formato desconhecido não quebra', () {
      expect(parseCssColor('banana'), isA<Color>());
    });
  });
}
