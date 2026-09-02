#!/usr/bin/env bash
# Full PropExcel regression: new-org chain + existing-org flows at end.
# Each run uses its own --output folder so videos/traces are not overwritten.
#
# Note: Playwright treats the spec argument as a regex. Parentheses in filenames
# must be escaped (e.g. New Lead Creation \(Auto-creates Contact\)).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT="${PLAYWRIGHT_PROJECT:-chromium}"
HEADED_FLAG=("--headed")
if [[ "${HEADED:-1}" == "0" ]]; then
  HEADED_FLAG=()
fi

run_spec() {
  local label="$1"
  local spec="$2"
  local out="$3"
  echo ""
  echo "======== ${label} → ${out} ========"
  npx playwright test "$spec" --project="$PROJECT" "${HEADED_FLAG[@]}" --output="$out"
}

run_spec "00 Cleanup" \
  "Cleanup Scenario" \
  "test-results/00-cleanup"

run_spec "01 CreateOrganization" \
  "CreateOrganization" \
  "test-results/01-create-org"

run_spec "02 Flow1-NewOrganization" \
  "Flow1-NewOrganization" \
  "test-results/02-flow1-new"

run_spec "03 Creating Contacts,Leads,Deals" \
  "Creating Contacts,Leads,Deals" \
  "test-results/03-contacts-leads-deals"

run_spec "03b Existing Deal -> Payment" \
  "Existing Deal" \
  "test-results/03b-existing-deal-payment"

run_spec "04 Existing Contact -> Payment" \
  "Existing Contact" \
  "test-results/04-existing-contact-payment"

run_spec "05 New Deal -> Payment" \
  "New Deal" \
  "test-results/05-new-deal-payment"

run_spec "06 New Lead Creation -> Payment" \
  'New Lead Creation \(Auto-creates Contact\)' \
  "test-results/06-new-lead-payment"

run_spec "07 New Contact -> Payment" \
  "New Contact" \
  "test-results/07-new-contact-payment"

run_spec "08 Flow2-NewOrganization" \
  "Flow2-NewOrganization" \
  "test-results/08-flow2-new"

run_spec "09 Flow1-ExistingOrganization" \
  "Flow1-ExistingOrganization" \
  "test-results/09-flow1-existing"

run_spec "10 Flow2-ExistingOrganization" \
  "Flow2-ExistingOrganization" \
  "test-results/10-flow2-existing"

echo ""
echo "All 12 specs finished. Videos under test-results/00-… through 10-…"
