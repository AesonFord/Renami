#!/usr/bin/env bash
# Applies Renami's GitHub security settings and rulesets. With --check, it reports where the repo
# differs from them and changes nothing. Run it after the repo goes public, and again whenever
# you want to undo drift.
# Needs gh, logged in as a repo admin, and jq.
#
# Usage: scripts/apply-repo-settings.sh [--check] [--repo OWNER/NAME]
set -euo pipefail

repo=AesonFord/Renami
check=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) check=1 ;;
    --repo) repo="${2:?--repo needs OWNER/NAME}"; shift ;;
    *) echo "usage: $0 [--check] [--repo OWNER/NAME]" >&2; exit 2 ;;
  esac
  shift
done

# ruleset_matches compares with jq; without it every ruleset would read as different.
if ! command -v jq >/dev/null; then
  echo "error: this script needs jq (https://jqlang.org). On macOS 15 and later it's /usr/bin/jq." >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
rulesets=(main release-tags)

# Several of these settings fail or do nothing on a private repo on the free plan, so stop
# before the first write rather than leave them half-applied.
visibility="$(gh api "repos/$repo" --jq .visibility)"
if [ "$visibility" != public ]; then
  echo "error: $repo is $visibility. Make it public first (release-and-site plan, Task 7)." >&2
  exit 1
fi

# One GET, filtered with gh's --jq. Prints "missing" when the call fails.
current() { gh api "repos/$repo$1" --jq "$2" 2>/dev/null || echo missing; }

ruleset_id() { gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$1\") | .id"; }

# True when the live ruleset has the file's rule types, no bypass actors, the file's name, target,
# enforcement and conditions, and, for each rule, exactly the parameter values the file sets.
# GitHub fills in defaults on what it returns, so parameters the file doesn't set are ignored.
ruleset_matches() {
  jq -e -n --slurpfile file "$1" --argjson live "$2" '
    $file[0] as $want
    | ($live.rules // []) as $rules
    | ([$want.rules[].type] | sort) == ([$rules[].type] | sort)
      and ($live.bypass_actors // []) == []
      and ([$want | .name, .target, .enforcement, .conditions] == [$live | .name, .target, .enforcement, .conditions])
      and all($want.rules[];
        .type as $type
        | (.parameters // {}) as $p
        | (first($rules[] | select(.type == $type)) // {}) as $r
        | (($r.parameters // {}) | with_entries(select(.key as $k | $p | has($k)))) == $p)' >/dev/null 2>&1
}

diffs=0
expect() {
  if [ "$2" != "$3" ]; then
    echo "differs: $1 is $2, want $3"
    diffs=$((diffs + 1))
  fi
}

check_all() {
  diffs=0
  expect "private vulnerability reporting" "$(current /private-vulnerability-reporting .enabled)" true
  # This endpoint answers 204 when alerts are on and 404 when they're off.
  if gh api "repos/$repo/vulnerability-alerts" >/dev/null 2>&1; then alerts=true; else alerts=false; fi
  expect "Dependabot alerts" "$alerts" true
  expect "Dependabot security updates" "$(current /automated-security-fixes .enabled)" true
  expect "secret scanning" "$(current '' .security_and_analysis.secret_scanning.status)" enabled
  expect "push protection" "$(current '' .security_and_analysis.secret_scanning_push_protection.status)" enabled
  expect "merge methods (squash,merge,rebase,delete branch)" \
    "$(current '' '[.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .delete_branch_on_merge] | map(tostring) | join(",")')" \
    "true,false,false,true"
  expect "actions (enabled,allowed,SHA pinning)" \
    "$(current /actions/permissions '[.enabled, .allowed_actions, .sha_pinning_required] | map(tostring) | join(",")')" \
    "true,selected,true"
  expect "selected actions (GitHub-owned,verified,patterns)" \
    "$(current /actions/permissions/selected-actions '[.github_owned_allowed, .verified_allowed, (.patterns_allowed | join(" "))] | map(tostring) | join(",")')" \
    "true,false,github/codeql-action/*"
  expect "default token (scope,can approve PRs)" \
    "$(current /actions/permissions/workflow '[.default_workflow_permissions, .can_approve_pull_request_reviews] | map(tostring) | join(",")')" \
    "read,false"
  expect "fork PR approval" "$(current /actions/permissions/fork-pr-contributor-approval .approval_policy)" first_time_contributors
  for name in "${rulesets[@]}"; do
    id="$(ruleset_id "$name")"
    if [ -z "$id" ]; then
      expect "ruleset $name" missing present
      continue
    fi
    live="$(gh api "repos/$repo/rulesets/$id" 2>/dev/null)" || live='{}'
    if ! ruleset_matches "$root/.github/rulesets/$name.json" "$live"; then
      expect "ruleset $name" different "as in .github/rulesets/$name.json"
    fi
  done
}

apply_all() {
  gh api -X PUT "repos/$repo/private-vulnerability-reporting" >/dev/null
  gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null
  gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null
  gh api -X PATCH "repos/$repo" --input - >/dev/null <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  },
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "delete_branch_on_merge": true
}
JSON
  # allowed_actions must be "selected" before the selected-actions list can be set.
  gh api -X PUT "repos/$repo/actions/permissions" -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true >/dev/null
  # github/codeql-action is listed in case the github org doesn't count as GitHub-owned.
  gh api -X PUT "repos/$repo/actions/permissions/selected-actions" --input - >/dev/null <<'JSON'
{ "github_owned_allowed": true, "verified_allowed": false, "patterns_allowed": ["github/codeql-action/*"] }
JSON
  gh api -X PUT "repos/$repo/actions/permissions/workflow" -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false >/dev/null
  gh api -X PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" -f approval_policy=first_time_contributors >/dev/null
  for name in "${rulesets[@]}"; do
    id="$(ruleset_id "$name")"
    if [ -n "$id" ]; then
      gh api -X PUT "repos/$repo/rulesets/$id" --input "$root/.github/rulesets/$name.json" >/dev/null
      echo "ruleset $name: updated ($id)"
    else
      gh api -X POST "repos/$repo/rulesets" --input "$root/.github/rulesets/$name.json" >/dev/null
      echo "ruleset $name: created"
    fi
  done
}

if [ "$check" = 0 ]; then
  apply_all
fi
# After applying, read everything back, so a setting GitHub silently ignored still shows up.
check_all
if [ "$diffs" -gt 0 ]; then
  exit 1
fi
echo "All settings match."
