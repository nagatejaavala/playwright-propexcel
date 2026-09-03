#!/usr/bin/env bash
# Resume company chain from C04 (C01–C03 already passed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${PLAYWRIGHT_PROJECT:-chromium}"
HEADED_FLAG=("--headed")
if [[ "${HEADED:-1}" == "0" ]]; then
  HEADED_FLAG=()
fi

DIR="Company category Scenario"

run_spec() {
  local label="$1"
  local spec="$2"
  local out="$3"
  echo ""
  echo "======== ${label} → ${out} ========"
  npx playwright test "tests/${DIR}/${spec}" --project="$PROJECT" "${HEADED_FLAG[@]}" --output="$out"
}

run_spec "C04 Existing Contact -> Payment (Company)" \
  "Existing Contact" \
  "test-results/company-04-existing-contact-payment"

run_spec "C05 New Deal -> Payment (Company)" \
  "New Deal" \
  "test-results/company-05-new-deal-payment"

run_spec "C06 New Lead Creation -> Payment (Company)" \
  'New Lead Creation \(Auto-creates Contact\)' \
  "test-results/company-06-new-lead-payment"

run_spec "C07 New Contact -> Payment (Company)" \
  "New Contact" \
  "test-results/company-07-new-contact-payment"

echo ""
echo "Company category chain (C04–C07) finished. Outputs under test-results/company-*"
