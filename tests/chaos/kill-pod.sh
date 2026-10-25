#!/usr/bin/env bash
set -euo pipefail

if [[ "${CONFIRM_CHAOS:-}" != "RUN-CHAOS" ]]; then
  echo "Refusing to delete a pod without CONFIRM_CHAOS=RUN-CHAOS" >&2
  exit 2
fi

NAMESPACE="${CHAOS_NAMESPACE:-}"
if [[ "$NAMESPACE" != "chaos-lab" ]]; then
  echo "Refusing chaos outside the isolated chaos-lab namespace" >&2
  exit 2
fi

SELECTOR="app=zwallet-chaos-target"
POD="$(kubectl get pods -n "$NAMESPACE" -l "$SELECTOR" -o jsonpath='{.items[0].metadata.name}')"
if [[ -z "$POD" ]]; then
  echo "No explicitly labeled chaos target pod exists in $NAMESPACE" >&2
  exit 1
fi

kubectl delete pod "$POD" -n "$NAMESPACE" --wait=false
