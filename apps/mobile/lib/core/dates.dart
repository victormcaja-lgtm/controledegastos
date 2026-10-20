/// Competência (`YYYY-MM`) e datas ISO (`YYYY-MM-DD`) como texto, igual ao
/// site e à API. Espelha `packages/shared/src/month.ts` e `apps/web/src/application/dates.ts`.
library;

const monthNamesShort = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

const monthNamesLong = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const weekdayInitials = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

String _two(int value) => value.toString().padLeft(2, '0');

/// "Hoje" no fuso do APARELHO — é o que a API recebe como `today`.
String localTodayISO([DateTime? now]) {
  final date = now ?? DateTime.now();
  return '${date.year}-${_two(date.month)}-${_two(date.day)}';
}

/// Competência atual. O site usa o mês em UTC (`currentMonthRef`); mantemos
/// o mesmo critério para pedir à API o mesmo mês que o site pediria.
String currentMonthRef([DateTime? now]) {
  final date = (now ?? DateTime.now()).toUtc();
  return '${date.year}-${_two(date.month)}';
}

DateTime _parseISO(String iso) => DateTime.utc(
      int.parse(iso.substring(0, 4)),
      int.parse(iso.substring(5, 7)),
      int.parse(iso.substring(8, 10)),
    );

String _formatUtc(DateTime date) => '${date.year}-${_two(date.month)}-${_two(date.day)}';

String addDaysISO(String iso, int amount) =>
    _formatUtc(_parseISO(iso).add(Duration(days: amount)));

String lastDayOfMonthISO(String iso) {
  final year = int.parse(iso.substring(0, 4));
  final month = int.parse(iso.substring(5, 7));
  return _formatUtc(DateTime.utc(year, month + 1, 0));
}

/// "15/10"
String shortDate(String iso) => '${iso.substring(8, 10)}/${iso.substring(5, 7)}';

/// "15/10/2026"
String fullDate(String iso) => '${shortDate(iso)}/${iso.substring(0, 4)}';

const _weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/// "Hoje", "Amanhã", "Ontem" ou "qua, 15 de outubro".
String dayLabel(String iso, String today) {
  if (iso == today) return 'Hoje';
  if (iso == addDaysISO(today, 1)) return 'Amanhã';
  if (iso == addDaysISO(today, -1)) return 'Ontem';
  final date = _parseISO(iso);
  return '${_weekdays[date.weekday % 7]}, ${date.day} de ${monthNamesLong[date.month - 1]}';
}

final _monthPattern = RegExp(r'^\d{4}-(0[1-9]|1[0-2])$');

bool isValidMonthRef(String value) => _monthPattern.hasMatch(value);

String addMonths(String month, int amount) {
  final year = int.parse(month.substring(0, 4));
  final index = int.parse(month.substring(5, 7)) - 1;
  final absolute = year * 12 + index + amount;
  final newYear = (absolute / 12).floor();
  final newMonth = ((absolute % 12) + 12) % 12 + 1;
  return '$newYear-${_two(newMonth)}';
}

String monthLabel(String month, {bool short = false}) {
  final index = int.parse(month.substring(5, 7)) - 1;
  final name = short ? monthNamesShort[index] : monthNamesLong[index];
  return '${name[0].toUpperCase()}${name.substring(1)} ${month.substring(0, 4)}';
}

String monthNameShort(String month) => monthNamesShort[int.parse(month.substring(5, 7)) - 1];
