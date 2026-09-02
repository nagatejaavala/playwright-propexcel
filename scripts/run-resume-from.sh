#!/usr/bin/env bash
# Resume the regression chain from a given step (00–10). Usage:
#   ./scripts/run-resume-from.sh 06
#   HEADED=0 ./scripts/run-resume-from.sh 08
set -euo pipefail

FROM="${1:-}"
if [[ -z "$FROM" ]]; then
  echo "Usage: $0 <step-number>   e.g. 06" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${PLAYWRIGHT_PROJECT:-chromium}"
HEADED_FLAG=("--headed")
if [[ "${HEADED:-1}" == "0" ]]; then
  HEADED_FLAG=()
fi

declare -a STEPS=(
  "00|Cleanup Scenario|test-results/00-cleanup"
  "01|CreateOrganization|test-results/01-create-org"
  "02|Flow1-NewOrganization|test-results/02-flow1-new"
  "03|Creating Contacts,Leads,Deals|test-results/03-contacts-leads-deals"
  "03b|Existing Deal|test-results/03b-existing-deal-payment"
  "04|Existing Contact|test-results/04-existing-contact-payment"
  "05|New Deal|test-results/05-new-deal-payment"
  '06|New Lead Creation \(Auto-creates Contact\)|test-results/06-new-lead-payment'
  "07|New Contact|test-results/07-new-contact-payment"
  "08|Flow2-NewOrganization|test-results/08-flow2-new"
  "09|Flow1-ExistingOrganization|test-results/09-flow1-existing"
  "10|Flow2-ExistingOrganization|test-results/10-flow2-existing"
)

run_spec() {
  local label="$1"
  local spec="$2"
  local out="$3"
  echo ""
  echo "======== ${label} → ${out} ========"
  npx playwright test "$spec" --project="$PROJECT" "${HEADED_FLAG[@]}" --output="$out"
}

started=0
for entry in "${STEPS[@]}"; do
  IFS='|' read -r num pattern out <<< "$entry"
  if [[ "$num" == "$FROM" ]]; then
    started=1
  fi
  if [[ "$started" -eq 1 ]]; then
    run_spec "$num" "$pattern" "$out"
  fi
done

if [[ "$started" -eq 0 ]]; then
  echo "Unknown step: $FROM (use 00, 01, 02, 03, 03b, 04, 05, 06, 07, 08, 09, or 10)" >&2
  exit 1
fi

echo ""
echo "Resume from step ${FROM} finished."