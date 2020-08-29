# Request Review Based on Files

![Test](https://github.com/necojackarc/request-review-based-on-files/workflows/Test/badge.svg)

A GitHub Action that automatically requests review of a pull request based on files changes and/or groups the author belongs to

## Notable Features
This GitHub Action enables you to:

- Auto-assign reviewers based on files changed
- Auto-assign reviewers based on groups that the author belongs to
- Request review only in certain conditions

###  Auto-assign reviewers based on files changed
You can define reviewers based on files using [glob](https://en.wikipedia.org/wiki/Glob_(programming)) expressions.

```yaml
files:
  '**/*.js':
    - js-lovers
```

### Auto-assign reviewers based on groups that the author belongs to
If you enable the group assignment feature, you can request code review to all of the other members of the groups you belong to.

```yaml
reviewers:
  groups:
    js-lovers:
      - js-man
      - js-woman

options:
  enable_group_assignment: false
```

### Request review only in certain conditions
If you don't like to have the pull requests considered not yet ready reviewed, you can set `ignore_draft` and `ignored_keywords` options.

If your pull request is a draft and `ignore_draft` is `true`, review requests won't be made. The same applies if your pull request title contains any of `ignored_keywords`.

```yaml
options:
  ignore_draft: true
  ignored_keywords:
    - DO NOT REVIEW
```

## Motivation
It varies depending on the team who should review which pull requests. In some teams, review requests are randomly assigned while others prefer to have them reviewed by every one of the team members. With the default features, [code review assignments](https://docs.github.com/en/github/setting-up-and-managing-organizations-and-teams/managing-code-review-assignment-for-your-team) and [code owners](https://docs.github.com/en/github/creating-cloning-and-archiving-repositories/about-code-owners), you can cover only a couple of user cases.

This GitHub Action best suits any of the following needs:

- You'd like to request review based on files changed
- You'd like to request review to all of the other team members
- You'd like to keep code owners real code owners, not just reviewers

Overall, if you'd like to request review to a certain set of members based on groups and/or files changed, this GitHub Action works best.

## Configuration
You need to prepare two YAML files for:

- Reviewers configuration
- Workflow configuration

### Reviewers configuration
Create a configuration file where you can define code reviewers in [glob](https://en.wikipedia.org/wiki/Glob_(programming)) expressions. Internally, [minimatch](https://github.com/isaacs/minimatch) is used as a glob implementation.

The format of a configuration file is as follows:

```yaml
reviewers:
  # Reviewer groups each of which has a list of GitHub usernames
  groups:
    repository-owner:
      - me # username
    core-contributors:
      - good-boy # username
      - good-girl # username
    js-lovers:
      - js-man # username
      - js-woman # username

files:
  # Keys are glob expressions.
  # You can assign groups defined above as well as GitHub usernames.
  '**':
    - repository-owner # group
  '**/*.js':
    - core-contributors # group
    - js-lovers # group
  '**/*.yml':
    - core-contributors # group
    - yamler # username
  '.github/**':
    - octopus # username
    - cat # username

options:
  ignore_draft: true
  ignored_keywords:
    - DO NOT REVIEW
  enable_group_assignment: false
```

The default configuration file location is `.github/request_review_based_on_files.yml` but you can override it in your workflow configuration file.

### Workflow configuration
Create a workflow file in `.github/workflows` (e.g. `.github/workflows/request_review_based_on_files.yml`):

```yaml
name: Request Review Based on Files

on:
  pull_request:
    types: [opened, ready_for_review, reopened]

jobs:
  request-review-based-on-files:
    name: Request review based on files changed
    runs-on: ubuntu-latest
    steps:
      - name: Assign reviewers to a pull request based on files changed
        uses: necojackarc/request-review-based-on-files@v0.1.0
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          config: .github/reviewers.yml # Config file location override
```