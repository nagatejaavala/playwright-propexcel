#!/usr/bin/env bash
# Run all 8 PropExcel specs in order. Each run uses its own --output folder
# so videos/screenshots/traces are kept for every file (not overwritten).
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

run_spec "01 CreateOrganization" \
  "tests/CreateOrganization.spec.ts" \
  "test-results/01-create-org"

run_spec "02 Flow1-NewOrganization" \
  "tests/Flow1-NewOrganization.spec.ts" \
  "test-results/02-flow1-new"

run_spec "03 Creating Contacts,Leads,Deals" \
  "tests/Creating Contacts,Leads,Deals.spec.ts" \
  "test-results/03-contacts-leads-deals"

run_spec "04 ExistingContact-ToTenantPayment" \
  "tests/ExistingContact-ToTenantPayment.spec.ts" \
  "test-results/04-existing-contact-payment"

run_spec "05 Skip lead flow - tenant Payment" \
  "tests/Skip lead flow - tenenat Payment.spec.ts" \
  "test-results/05-skip-lead-payment"

run_spec "06 Flow2-NewOrganization" \
  "tests/Flow2-NewOrganization.spec.ts" \
  "test-results/06-flow2-new"

run_spec "07 Flow1-ExistingOrganization" \
  "tests/Flow1-ExistingOrganization.spec.ts" \
  "test-results/07-flow1-existing"

run_spec "08 Flow2-ExistingOrganization" \
  "tests/Flow2-ExistingOrganization.spec.ts" \
  "test-results/08-flow2-existing"

echo ""
echo "All 8 specs finished. Videos are under test-results/01-… through 08-…"
