#!/usr/bin/env bash
# SPDX-License-Identifier: BSL-1.1
# Copyright (c) 2026 MuVeraAI Corporation
#
# Fire Line Audit — scans all source files for forbidden identifiers.
# Exit code 0 = clean, 1 = violation found.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FORBIDDEN=(
  "progressLevel"
  "promoteLevel"
  "computeTrustScore"
  "behavioralScore"
  "adaptiveBudget"
  "optimizeBudget"
  "predictSpending"
  "detectAnomaly"
  "generateCounterfactual"
  "PersonalWorldModel"
  "MissionAlignment"
  "MissionAlignmentEngine"
  "SocialTrust"
  "SocialTrustProtocol"
  "CognitiveLoop"
  "AttentionFilter"
  "GOVERNANCE_PIPELINE"
)

VIOLATIONS=0

for term in "${FORBIDDEN[@]}"; do
  if grep -rn --include="*.ts" --include="*.py" --include="*.go" --include="*.rs" \
       --include="*.js" --include="*.mjs" --include="*.cjs" \
       "$term" "$REPO_ROOT/packages/" 2>/dev/null; then
    echo "FIRE LINE VIOLATION: Found '$term'"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
  echo ""
  echo "FAILED: $VIOLATIONS fire line violation(s) found."
  exit 1
else
  echo "PASSED: Zero fire line violations."
  exit 0
fi
