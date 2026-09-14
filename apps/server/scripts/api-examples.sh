#!/usr/bin/env bash
# Примеры всех запросов API на curl. Виртуальное время берется из /api/sim,
# поэтому скрипт можно запускать сразу после старта сервера.
#
# Запуск: ./scripts/api-examples.sh [адрес] [показать-тела]
#   ./scripts/api-examples.sh                     # только коды ответов и размеры
#   ./scripts/api-examples.sh http://localhost:3001 1   # с телами ответов

set -euo pipefail

HOST="${1:-http://localhost:3001}"
SHOW_BODY="${2:-0}"

NOW=$(curl -fsS "$HOST/api/sim" | sed -n 's/.*"simTime":\([0-9]*\).*/\1/p')
if [ -z "$NOW" ]; then
  echo "не удалось получить виртуальное время из $HOST/api/sim" >&2
  exit 1
fi
H1=$((NOW - 3600))
H12=$((NOW - 43200))
M15=$((NOW - 900))

echo "виртуальное время симуляции: $NOW"

request() {
  local title="$1"
  shift
  printf '\n=== %s\n' "$title"
  if [ "$SHOW_BODY" = "1" ]; then
    curl -fsS "$@" | head -c 2000
    echo
  else
    curl -fsS -o /tmp/ra-api-response.json -w 'HTTP %{http_code}, %{size_download} байт, %{time_total} с\n' "$@"
  fi
}

request "состояние сервера" "$HOST/api/health"
request "состояние симуляции" "$HOST/api/sim"
request "конфигурация" "$HOST/api/config"
request "справочники" "$HOST/api/dictionaries"
request "список машин" "$HOST/api/vehicles"
request "последние снапшоты" "$HOST/api/telemetry/latest"
request "серии: все показатели светофора, час" \
  "$HOST/api/telemetry/series?from=$H1&to=$NOW&maxPoints=1000"
request "серии: 12 часов, 1000 точек" \
  "$HOST/api/telemetry/series?vehicleIds=v-12,v-07&metrics=ENGINE_COOLANT_TEMPERATURE,BRAKE_TEMPERATURE_MAX&from=$H12&to=$NOW&maxPoints=1000"
request "серии: 15 минут на сыром уровне" \
  "$HOST/api/telemetry/series?vehicleIds=v-12&metrics=ENGINE_RPM&from=$M15&to=$NOW&maxPoints=1000"
request "треки за час" "$HOST/api/telemetry/track?from=$H1&to=$NOW&maxPoints=600"
request "трек со светофором только по тормозам" \
  "$HOST/api/telemetry/track?vehicleIds=v-12&from=$H1&to=$NOW&severityMetrics=BRAKE_TEMPERATURE_FRONT_LEFT,BRAKE_TEMPERATURE_REAR_LEFT"
request "события за 12 часов" "$HOST/api/events?from=$H12&to=$NOW&limit=500"
request "аварии одной машины" "$HOST/api/events?vehicleIds=v-12&from=$H12&to=$NOW&severity=2&limit=500"
request "сводка за 12 часов" "$HOST/api/vehicles/v-12/summary?from=$H12&to=$NOW"

printf '\n=== изменение параметров симуляции\n'
curl -fsS -X POST "$HOST/api/sim" -H 'content-type: application/json' \
  -d '{"vehicleCount":60,"timeScale":60,"chaos":"UGLY"}'
printf '\n=== возврат к демонстрационному режиму\n'
curl -fsS -X POST "$HOST/api/sim" -H 'content-type: application/json' \
  -d '{"vehicleCount":3,"timeScale":1,"chaos":"NORMAL"}'
echo
