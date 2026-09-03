#!/usr/bin/env bash
# Company-category regression chain (Contact Type = Company).
# Does not modify Individual suites under tests/*.spec.ts.
#
# Prereq: org already created (test-data/org.json), typically after
# Cleanup + CreateOrganization from scripts/run-full-chain.sh.
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

run_spec "C01 Flow1-NewOrganization (Company)" \
  "Flow1-NewOrganization" \
  "test-results/company-01-flow1-new"

run_spec "C02 Creating Contacts,Leads,Deals (Company)" \
  "Creating Contacts,Leads,Deals" \
  "test-results/company-02-contacts-leads-deals"

run_spec "C03 Existing Deal -> Payment (Company)" \
  "Existing Deal" \
  "test-results/company-03-existing-deal-payment"

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
echo "Company category chain finished. Outputs under test-results/company-*"
