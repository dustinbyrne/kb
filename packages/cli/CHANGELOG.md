# @dustinbyrne/kb

## 0.3.0

### Minor Changes

- fc7582d: Expand agent.log logging to all agent types, additionally capturing thinking, and agent roles
- cc999ef: RETHINK verdicts trigger git reset and conversation rewind, re-prompting the agent with feedback

### Patch Changes

- f3c7f7d: CLI `task create` now supports a `--depends <id>` flag (repeatable) to declare task dependencies at creation time.
- fc7582d: Code review REVISE verdicts are now enforced such that agents can no longer advance steps without APPROVE
- cc999ef: Plan RETHINK triggers conversation rewind with REVISE enforcement on code reviews
- cc999ef: Dependent tasks can start from in-review dependency branches instead of waiting for merge

## 0.2.1

### Patch Changes

- efdb7de: Clean up README: plain ASCII file tree, mermaid workflow diagram with column descriptions, update quick start to use `kb` CLI, add authentication section to CLI README, document cross-model review in executor description.

## 0.2.0

### Minor Changes

- b12d340: Add automated versioning pipeline using changesets. Developers now add changeset files to describe changes, and a CI workflow automatically opens version PRs that bump versions and generate changelogs.
