'use strict';

const core = require('@actions/core');
const fs = require('fs');
const github = require('@actions/github');
const partition = require('lodash/partition');
const yaml = require('yaml');
const { LOCAL_FILE_MISSING } = require('./constants');
// Applying Additional Plugins to Octokit from Github
// https://github.com/actions/toolkit/tree/main/packages/github#extending-the-octokit-instance
const github_utils = require('@actions/github/lib/utils');
const { paginateGraphql } = require('@octokit/plugin-paginate-graphql');

class PullRequest {
  // ref: https://developer.github.com/v3/pulls/#get-a-pull-request
  constructor(pull_request_paylaod) {
    // "ncc" doesn't yet support private class fields as of 29 Aug. 2020
    // ref: https://github.com/vercel/ncc/issues/499
    this._pull_request_paylaod = pull_request_paylaod;
  }

  get author() {
    return this._pull_request_paylaod.user.login;
  }

  get title() {
    return this._pull_request_paylaod.title;
  }

  get is_draft() {
    return this._pull_request_paylaod.draft;
  }
}

function get_pull_request() {
  const context = get_context();

  return new PullRequest(context.payload.pull_request);
}

async function fetch_config() {
  const context = get_context();
  const octokit = get_octokit();
  const config_path = get_config_path();
  const useLocal = get_use_local();
  let content = '';

  if (!useLocal) {
    const { data: response_body } = await octokit.repos.getContent({
      owner: context.repo.owner,
      repo: context.repo.repo,
      path: config_path,
      ref: context.ref,
    });

    content = Buffer.from(response_body.content, response_body.encoding).toString();
  } else {
    try {
      content = fs.readFileSync(config_path).toString();

      if (!content) {
        throw new Error();
      }
    } catch (error) {
      core.debug(`Error when reading local file: ${error}`);

      throw new Error(LOCAL_FILE_MISSING);
    }
  }

  return yaml.parse(content);
}

async function fetch_changed_files() {
  const context = get_context();
  const octokit = get_octokit();

  const changed_files = [];

  const per_page = 100;
  let page = 0;
  let number_of_files_in_current_page;

  do {
    page += 1;

    const { data: response_body } = await octokit.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
      page,
      per_page,
    });

    number_of_files_in_current_page = response_body.length;
    changed_files.push(...response_body.map((file) => file.filename));

  } while (number_of_files_in_current_page === per_page);

  return changed_files;
}

async function fetch_reviewers() {
  const context = get_context();
  const octokit = get_octokit();

  const reviewers = new Set();
  const per_page = 100;

  // GraphQL Docs: https://docs.github.com/en/graphql/reference/unions#pullrequesttimelineitems
  // Pagination: https://github.com/octokit/plugin-paginate-graphql.js/?tab=readme-ov-file#usage
  const response = await octokit.graphql.paginate(
    `
    query paginate($cursor: String, $repo: String!, $owner: String!, $number: Int!, $per_page: Int!) {
      repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
              timelineItems(first: $per_page, after: $cursor, itemTypes: [REVIEW_REQUESTED_EVENT, PULL_REQUEST_REVIEW]) {
                  nodes {
                      ... on ReviewRequestedEvent {
                          requestedReviewer {
                            ... on User {
                                  login
                            }
                            ... on Team {
                                  slug
                            }
                          }
                      }
                      ... on PullRequestReview {
                        author {
                          login
                        }
                        state
                      }
                  }
                  pageInfo {
                      hasNextPage
                      endCursor
                  }
              }
          }
      }
  }`,
    {
      owner: context.repo.owner,
      repo: context.repo.repo,
      number: context.payload.pull_request.number,
      per_page: per_page,
    }
  );

  const eventNodes = response?.repository?.pullRequest?.timelineItems?.nodes || [];
  eventNodes.forEach((timelineEvent) => {
    if (timelineEvent?.requestedReviewer?.slug) {
      reviewers.add('team:'.concat(timelineEvent.requestedReviewer.slug));
    } else if (timelineEvent?.requestedReviewer?.login) {
      reviewers.add(timelineEvent.requestedReviewer.login);
    } else if (timelineEvent?.state && timelineEvent.state === 'APPROVED' && timelineEvent?.author?.login) {
      reviewers.add(timelineEvent.author.login);
    }
  });

  return [ ...reviewers ];
}

async function filter_only_collaborators(reviewers) {
  const context = get_context();
  const octokit = get_octokit();

  const [ teams_with_prefix, individuals ] = partition(reviewers, (reviewer) => reviewer.startsWith('team:'));
  const teams = teams_with_prefix.map((team_with_prefix) => team_with_prefix.replace('team:', ''));

  // Create a list of requests for all available aliases and teams to see if they have permission
  // to the PR associated with this action
  const collaborator_responses = [];
  teams.forEach((team) => {
    collaborator_responses.push(octokit.teams.checkPermissionsForRepoInOrg({
      org: context.repo.owner,
      team_slug: team,
      owner: context.repo.owner,
      repo: context.repo.repo,
    }).then((response) => {
      // https://docs.github.com/en/rest/teams/teams?apiVersion=2022-11-28#check-team-permissions-for-a-repository
      // Its expected that a team with permission will return 204
      core.info(`Received successful status code ${response?.status ?? 'Unknown'} for team: ${team}`);
      return 'team:'.concat(team);
    }).catch((error) => core.error(`Team: ${team} failed to be added with error: ${error}`)));
  });
  individuals.forEach((alias) => {
    collaborator_responses.push(octokit.repos.checkCollaborator({
      owner: context.repo.owner,
      repo: context.repo.repo,
      username: alias,
    }).then((response) => {
      // https://docs.github.com/en/rest/collaborators/collaborators?apiVersion=2022-11-28#check-if-a-user-is-a-repository-collaborator
      // Its expected that a collaborator with permission will return 204
      core.info(`Received successful status code ${response?.status ?? 'Unknown'} for alias: ${alias}`);
      return alias;
    }).catch((error) => core.error(`Individual: ${alias} failed to be added with error: ${error}`)));
  });

  // Store the aliases and teams of all successful responses
  const collaborators = [];
  await Promise.allSettled(collaborator_responses).then((results) => {
    results.forEach((result) => {
      if (result?.value) {
        collaborators.push(result?.value);
      }
    });
  });

  // Only include aliases and teams that exist as collaborators
  const filtered_reviewers = reviewers.filter((reviewer) => collaborators.includes(reviewer));
  core.info(`Filtered list of only collaborators ${filtered_reviewers.join(', ')}`);
  return filtered_reviewers;
}

async function assign_reviewers(reviewers) {
  const context = get_context();
  const octokit = get_octokit();

  const [ teams_with_prefix, individuals ] = partition(reviewers, (reviewer) => reviewer.startsWith('team:'));
  const teams = teams_with_prefix.map((team_with_prefix) => team_with_prefix.replace('team:', ''));

  return octokit.pulls.requestReviewers({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
    reviewers: individuals,
    team_reviewers: teams,
  });
}

/* Private */

let context_cache;
let token_cache;
let config_path_cache;
let use_local_cache;
let octokit_cache;

function get_context() {
  return context_cache || (context_cache = github.context);
}

function get_token() {
  return token_cache || (token_cache = core.getInput('token'));
}

function get_config_path() {
  return config_path_cache || (config_path_cache = core.getInput('config'));
}

function get_use_local() {
  return use_local_cache ?? (use_local_cache = core.getInput('use_local') === 'true');
}

function get_octokit() {
  if (octokit_cache) {
    return octokit_cache;
  }

  // Applying Additional Plugins to Octokit from Github
  // https://github.com/actions/toolkit/tree/main/packages/github#extending-the-octokit-instance
  const token = get_token();
  const octokitWithPlugin = github_utils.GitHub.plugin(paginateGraphql);
  return octokit_cache = new octokitWithPlugin(github_utils.getOctokitOptions(token));
}

function clear_cache() {
  context_cache = undefined;
  token_cache = undefined;
  config_path_cache = undefined;
  octokit_cache = undefined;
}

module.exports = {
  get_pull_request,
  fetch_config,
  fetch_changed_files,
  fetch_reviewers,
  filter_only_collaborators,
  assign_reviewers,
  clear_cache,
};
