'use strict';

const core = require('@actions/core');
const { LOCAL_FILE_MISSING } = require('./constants');
const github = require('./github'); // Don't destructure this object to stub with sinon in tests

const {
  fetch_other_group_members,
  identify_reviewers_by_changed_files,
  identify_reviewers_by_author,
  should_request_review,
  fetch_default_reviewers,
  randomly_pick_reviewers,
  fetch_all_reviewers,
} = require('./reviewer');

// Helper for checking the state of the action parameter to validate all reviewers.
let validate_all_reviewers_cache;
function get_validate_all_reviewers() {
  return validate_all_reviewers_cache ?? (validate_all_reviewers_cache = core.getInput('validate_all') === 'true');
}

async function run() {
  core.info('Fetching configuration file from the source branch');

  let config;

  try {
    config = await github.fetch_config();
  } catch (error) {
    if (error.status === 404) {
      core.warning('No configuration file is found in the base branch; terminating the process');
      return;
    }

    if (error.message === LOCAL_FILE_MISSING) {
      core.warning('No configuration file is found locally; terminating the process');
      return;
    }

    throw error;
  }

  const { title, is_draft, author } = github.get_pull_request();

  if (!should_request_review({ title, is_draft, config })) {
    core.info('Matched the ignoring rules; terminating the process');
    return;
  }

  core.info('Fetching changed files in the pull request');
  const changed_files = await github.fetch_changed_files();

  core.info('Fetching reviewers');
  const requested_approved_reviewers = await github.fetch_reviewers();
  core.info(`Aliases already requested or approved: ${requested_approved_reviewers.join(', ')}`);

  core.info('Identifying reviewers based on the changed files');
  const reviewers_based_on_files = identify_reviewers_by_changed_files({ config, changed_files, excludes: [ author ] });

  core.info('Identifying reviewers based on the author');
  const reviewers_based_on_author = identify_reviewers_by_author({ config, author });

  core.info('Adding other group members to reviewers if group assignment feature is on');
  const reviewers_from_same_teams = fetch_other_group_members({ config, author });

  let reviewers = [ ...new Set([ ...reviewers_based_on_files, ...reviewers_based_on_author, ...reviewers_from_same_teams ]) ];

  if (reviewers.length === 0) {
    core.info('Matched no reviewers');
    const default_reviewers = fetch_default_reviewers({ config, excludes: [ author ] });

    if (default_reviewers.length === 0) {
      core.info('No default reviewers are matched; terminating the process');
      return;
    }

    core.info('Falling back to the default reviewers');
    reviewers.push(...default_reviewers);
  }

  core.info(`Possible Reviewers ${reviewers.join(', ')}, prepare filtering out already requested reviewers or approved reviewers`);
  reviewers = reviewers.filter((reviewer) => !requested_approved_reviewers.includes(reviewer));

  core.info(`Possible New Reviewers ${reviewers.join(', ')}, prepare to filter to only collaborators`);
  let aliases_missing_access;
  [ reviewers, aliases_missing_access ] = await github.filter_only_collaborators(reviewers);

  // Note the following logic is to run only when the "validate_all" parameter is set (usually set when the reviewers config file
  // has changed in PR and the user of the action wants to validate the PR is not adding any aliases without access to the repo).
  // This section could arguably be its own action. Since both a lot of the same github access / building blocks / apis are used
  // in the same way as the above add reviewers logic and github doesn't have a good way to produce multiple independent actions
  // in the same repository, the current compromise is to keep this part of the action as an optional validation.
  if (get_validate_all_reviewers()) {
    core.info('Action ran in validate all mode, retrieving all possible reviewers inside config file');
    let all_reviewers = fetch_all_reviewers(config);

    // Make sure we only check access for aliases we have not already checked above.
    all_reviewers = all_reviewers.filter((reviewer) => !reviewers.includes(reviewer) && !aliases_missing_access.includes(reviewer));

    core.info(`All possible reviewers: ${all_reviewers.join(', ')}`);
    const [ , additional_missing_access ] = await github.filter_only_collaborators(all_reviewers);
    aliases_missing_access = [ ...aliases_missing_access, ...additional_missing_access ];
  }

  core.info('Randomly picking reviewers if the number of reviewers is set');
  reviewers = randomly_pick_reviewers({ reviewers, config });

  if (reviewers.length > 0) {
    core.info(`Requesting review to ${reviewers.join(', ')}`);
    await github.assign_reviewers(reviewers);
  } else {
    core.info('No new reviewers to assign to PR');
  }

  // If we either have reviewers without access OR this action has previously created a comment,
  // trigger updating our comment with the latest information.
  const existing_comment = await github.get_existing_comment();
  if (aliases_missing_access.length > 0 || existing_comment) {
    core.info('Found reviewers without access, preparing to add notification to PR');
    await github.post_notification(aliases_missing_access, existing_comment);
  }
}

module.exports = {
  run,
};

// Run the action if it's not running in an automated testing environment
if (process.env.NODE_ENV !== 'automated-testing') {
  run().catch((error) => core.setFailed(error));
}
