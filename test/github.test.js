'use strict';

const core = require('@actions/core');
const fs = require('fs');
const github = require('@actions/github');
const sinon = require('sinon');
const yaml = require('yaml');

// rewire's method name needs to be disabled from lint since we don't control it
/* eslint no-underscore-dangle: ["error", { "allow": ["__set__"] }] */
const rewire = require('rewire');

const { ContextStub } = require('./stubs/context');
const { expect } = require('chai');

describe('github', function() {
  // Rewired is used to set our octokit mock to the private octokit cache variable
  const rewired_github = rewire('../src/github');

  beforeEach(function() {
    rewired_github.clear_cache();

    const context = ContextStub.build();
    github.context = context;

    sinon.stub(core, 'getInput');
  });

  afterEach(function() {
    core.getInput.restore();
  });

  describe('get_pull_request()', function() {
    it('returns pull request data', function() {
      const pull_request = rewired_github.get_pull_request();

      // See the default values of ContextStub
      expect(pull_request.title).to.equal('Extract GitHub related functions into a github module');
      expect(pull_request.author).to.equal('necojackarc');
      expect(pull_request.is_draft).to.be.false;
    });
  });

  describe('fetch_config()', function() {
    const config_path = 'test/assets/reviewers.yml';
    const encoding = 'utf8';
    const content = fs.readFileSync(config_path, encoding);

    const octokit = {
      repos: {
        getContent() {
          return {
            data: {
              encoding,
              content,
            },
          };
        },
      },
    };

    let restoreModule;
    beforeEach(function() {
      core.getInput.withArgs('config').returns(config_path);
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });

    afterEach(function() {
      restoreModule();
    });

    it('returns a config object', async function() {
      const expected = yaml.parse(Buffer.from(content, encoding).toString());
      const actual = await rewired_github.fetch_config();
      expect(actual).to.deep.equal(expected);
    });
  });

  describe('fetch_changed_files()', function() {
    const stub = sinon.stub();
    const octokit = {
      pulls: {
        listFiles: stub,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      restoreModule();
    });

    it('fetch changed files', async function() {
      stub.returns({
        data: [
          { filename: 'super/mario/64' },
          { filename: 'paper/mario' },
        ],
      });
      const expected = [ 'super/mario/64', 'paper/mario' ];
      const actual = await rewired_github.fetch_changed_files();
      expect(actual).to.deep.equal(expected);
    });

    it('fetch changed files through the last page', async function() {
      const filenames = [];
      for (let index = 0; index < 222; index += 1) {
        filenames.push(`path/to/file${index}`);
      }

      const page_size = 100;
      const filenames_in_chunks = [];
      for (let index = 0; index < filenames.length; index += page_size) {
        filenames_in_chunks.push(filenames.slice(index, index + page_size));
      }

      // Make sure filenames are correctly split into chunks
      expect(filenames_in_chunks[0].length).to.equal(100);
      expect(filenames_in_chunks[1].length).to.equal(100);
      expect(filenames_in_chunks[2].length).to.equal(22);

      stub.onCall(1).returns({ data: filenames_in_chunks[0].map((filename) => ({ filename })) });
      stub.onCall(2).returns({ data: filenames_in_chunks[1].map((filename) => ({ filename })) });
      stub.onCall(3).returns({ data: filenames_in_chunks[2].map((filename) => ({ filename })) });

      const changed_files = await rewired_github.fetch_changed_files();
      expect(changed_files).to.have.members(filenames);
    });
  });

  describe('fetch_reviewers()', function() {
    const stub = sinon.stub();
    const octokit = {
      graphql: {
        paginate: stub,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      restoreModule();
    });

    it('fetches reviewers - empty response', async function() {
      const expected = [ ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches reviewers - unexpected response', async function() {
      stub.returns({
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                { unknown_timeline_event: { id: '1234' } },
              ],
            },
          },
        },
      });
      const expected = [ ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches reviewers - requested user only', async function() {
      stub.returns({
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                { requestedReviewer: { login: 'super/mario/64' } },
              ],
            },
          },
        },
      });
      const expected = [ 'super/mario/64' ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches reviewers - requested team only', async function() {
      stub.returns({
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                { requestedReviewer: { slug: 'super_marios' } },
              ],
            },
          },
        },
      });
      const expected = [ 'team:super_marios' ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches reviewers - combined requested users and teams', async function() {
      stub.returns({
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                { requestedReviewer: { login: 'bowser' } },
                { requestedReviewer: { login: 'peach' } },
                { requestedReviewer: { login: 'luigi' } },
                { requestedReviewer: { slug: 'super_marios' } },
                { requestedReviewer: { slug: 'toads' } },
              ],
            },
          },
        },
      });
      const expected = [ 'bowser', 'peach', 'luigi', 'team:super_marios', 'team:toads' ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches reviewers - approved users', async function() {
      stub.returns({
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                {
                  author: { login: 'bowser' },
                  state: 'APPROVED',
                },
                {
                  author: { login: 'peach' },
                  state: 'CHANGES_REQUESTED',
                },
              ],
            },
          },
        },
      });
      const expected = [ 'bowser' ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches reviewers - mixed approved and requested', async function() {
      stub.returns({
        repository: {
          pullRequest: {
            timelineItems: {
              nodes: [
                { requestedReviewer: { login: 'bowser' } },
                { requestedReviewer: { login: 'peach' } },
                { requestedReviewer: { login: 'luigi' } },
                { requestedReviewer: { slug: 'super_marios' } },
                { requestedReviewer: { slug: 'toads' } },
                {
                  author: { login: 'bowser' },
                  state: 'APPROVED',
                },
                {
                  author: { login: 'mario' },
                  state: 'APPROVED',
                },
              ],
            },
          },
        },
      });
      const expected = [ 'bowser', 'peach', 'luigi', 'team:super_marios', 'team:toads', 'mario' ];
      const actual = await rewired_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });
  });

  describe('split_reviewers()', function() {
    it('empty list', function() {
      const [ individuals, teams ] = rewired_github.split_reviewers([]);

      expect(individuals).to.deep.equal([]);
      expect(teams).to.deep.equal([]);
    });

    it('only individuals', function() {
      const [ individuals, teams ] = rewired_github.split_reviewers([ 'mario', 'luigi' ]);

      expect(individuals).to.deep.equal([ 'mario', 'luigi' ]);
      expect(teams).to.deep.equal([]);
    });

    it('only teams', function() {
      const [ individuals, teams ] = rewired_github.split_reviewers([ 'team:super_marios', 'team:toads' ]);

      expect(individuals).to.deep.equal([]);
      expect(teams).to.deep.equal([ 'super_marios', 'toads' ]);
    });
  });

  describe('filter_only_collaborators()', function() {
    const teamStub = sinon.stub();
    const aliasStub = sinon.stub();
    const octokit = {
      repos: {
        checkCollaborator: aliasStub,
      },
      teams: {
        checkPermissionsForRepoInOrg: teamStub,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      teamStub.reset();
      aliasStub.reset();
      restoreModule();
    });

    it('remove non collaborators - individual', async function() {
      const allCandidates = [ 'bowser', 'peach', 'luigi', 'mario' ];

      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'bowser',
      }).rejects();
      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'peach',
      }).resolves({ status: '204' });
      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'luigi',
      }).rejects();
      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'mario',
      }).resolves({ status: '204' });

      const actual = await rewired_github.filter_only_collaborators(allCandidates);
      expect(actual).to.deep.equal([ [ 'peach', 'mario' ], [ 'bowser', 'luigi' ] ]);
      expect(teamStub.called).to.be.false;
      expect(aliasStub.callCount).to.be.equal(4);
    });

    it('remove non collaborators - teams', async function() {
      const allCandidates = [ 'team:koopa-troop', 'team:toads', 'team:peach-alliance', 'team:bowser-and-co' ];

      teamStub.withArgs({
        org: 'necojackarc',
        team_slug: 'koopa-troop',
        owner: 'necojackarc',
        repo: 'auto-request-review',
      }).resolves({ status: '204' });
      teamStub.withArgs({
        org: 'necojackarc',
        team_slug: 'toads',
        owner: 'necojackarc',
        repo: 'auto-request-review',
      }).rejects();
      teamStub.withArgs({
        org: 'necojackarc',
        team_slug: 'peach-alliance',
        owner: 'necojackarc',
        repo: 'auto-request-review',
      }).rejects();
      teamStub.withArgs({
        org: 'necojackarc',
        team_slug: 'bowser-and-co',
        owner: 'necojackarc',
        repo: 'auto-request-review',
      }).resolves({ status: '204' });

      const actual = await rewired_github.filter_only_collaborators(allCandidates);
      expect(actual).to.deep.equal([ [ 'team:koopa-troop', 'team:bowser-and-co' ], [ 'team:toads', 'team:peach-alliance' ] ]);
      expect(teamStub.callCount).to.be.equal(4);
      expect(aliasStub.called).to.be.false;
    });

    it('remove non collaborators - mixed', async function() {
      const allCandidates = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];

      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'peach',
      }).resolves({ status: '204' });
      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'luigi',
      }).rejects();
      aliasStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        username: 'mario',
      }).rejects();

      teamStub.withArgs({
        org: 'necojackarc',
        team_slug: 'peach-alliance',
        owner: 'necojackarc',
        repo: 'auto-request-review',
      }).resolves({ status: '204' });
      teamStub.withArgs({
        org: 'necojackarc',
        team_slug: 'bowser-and-co',
        owner: 'necojackarc',
        repo: 'auto-request-review',
      }).rejects();

      const actual = await rewired_github.filter_only_collaborators(allCandidates);
      expect(actual).to.deep.equal([ [ 'peach', 'team:peach-alliance' ], [ 'luigi', 'mario', 'team:bowser-and-co' ] ]);
      expect(teamStub.callCount).to.be.equal(2);
      expect(aliasStub.callCount).to.be.equal(3);
    });
  });

  describe('assign_reviewers()', function() {
    const spy = sinon.spy();
    const octokit = {
      pulls: {
        requestReviewers: spy,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      restoreModule();
    });

    it('assigns reviewers', async function() {
      const reviewers = [ 'mario', 'princess-peach', 'team:koopa-troop' ];
      await rewired_github.assign_reviewers(reviewers);

      expect(spy.calledOnce).to.be.true;
      expect(spy.lastCall.args[0]).to.deep.equal({
        owner: 'necojackarc',
        pull_number: 18,
        repo: 'auto-request-review',
        reviewers: [
          'mario',
          'princess-peach',
        ],
        team_reviewers: [
          'koopa-troop',
        ],
      });
    });
  });

  describe('get_comment_footer()', function() {
    it('uses pull request context', function() {
      const footer = rewired_github.get_comment_footer();

      const expectedId = Buffer.from('auto-request-review-18').toString('base64');
      expect(footer).to.include(expectedId);
    });
  });

  describe('get_existing_comment()', function() {
    const commentStub = sinon.stub();
    const octokit = {
      issues: {
        listComments: commentStub,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      commentStub.reset();
      restoreModule();
    });

    it('Empty Response', async function() {
      const comment = await rewired_github.get_existing_comment();
      expect(comment).to.equal(undefined);
      expect(commentStub.callCount).to.be.equal(1);
    });

    it('No Robot Comments', async function() {
      commentStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        issue_number: 18,
      }).returns({
        data: [
          { body: 'Thank you for making this change Mario.' },
          { body: 'Your princess is in another castle.' },
        ],
      });

      const comment = await rewired_github.get_existing_comment();
      expect(comment).to.equal(undefined);
      expect(commentStub.callCount).to.be.equal(1);
    });

    it('Single Robot Comment', async function() {
      const robotComment = {
        body: `Missing Reviewers ${rewired_github.get_comment_footer()}`,
      };

      commentStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        issue_number: 18,
      }).returns({
        data: [
          { body: 'Thank you for making this change Mario.' },
          { body: 'Your princess is in another castle.' },
          robotComment,
        ],
      });

      const comment = await rewired_github.get_existing_comment();
      expect(comment).to.equal(robotComment);
      expect(commentStub.callCount).to.be.equal(1);
    });

    it('Multiple Robot Comment', async function() {
      const robotComment = {
        body: `Missing Reviewers ${rewired_github.get_comment_footer()}`,
      };
      const secondComment = {
        body: `Second Comment ${rewired_github.get_comment_footer()}`,
      };

      commentStub.withArgs({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        issue_number: 18,
      }).returns({
        data: [
          { body: 'Thank you for making this change Mario.' },
          robotComment,
          { body: 'Your princess is in another castle.' },
          secondComment,
        ],
      });

      const comment = await rewired_github.get_existing_comment();
      expect(comment).to.equal(robotComment);
      expect(commentStub.callCount).to.be.equal(1);
    });
  });

  describe('get_missing_access_message()', function() {
    it('individuals only', function() {
      const reviewers = [ 'bowser', 'peach', 'luigi', 'mario' ];
      const message = rewired_github.get_missing_access_message(reviewers);
      const footer = rewired_github.get_comment_footer();

      // Message should always contain footer
      expect(message).to.include(footer);

      // Should not include appropriate headers
      expect(message).to.not.include('Team Alias');
      expect(message).to.include('Individual Alias');

      // Message should contain every reviewer
      reviewers.forEach((reviewer) => {
        expect(message).to.include(reviewer);
      });
    });

    it('teams only', function() {
      const reviewers = [ 'team:koopa-troop', 'team:toads', 'team:peach-alliance', 'team:bowser-and-co' ];
      const message = rewired_github.get_missing_access_message(reviewers);
      const footer = rewired_github.get_comment_footer();

      // Message should always contain footer
      expect(message).to.include(footer);

      // Should not include appropriate headers
      expect(message).to.include('Team Alias');
      expect(message).to.not.include('Individual Alias');

      // Message should contain every reviewer
      reviewers.map((reviewer) => reviewer.replace('team:', '')).forEach((reviewer) => {
        expect(message).to.include(reviewer);
      });
    });

    it('mixed', function() {
      const reviewers = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];
      const message = rewired_github.get_missing_access_message(reviewers);
      const footer = rewired_github.get_comment_footer();

      // Message should always contain footer
      expect(message).to.include(footer);

      // Should not include appropriate headers
      expect(message).to.include('Team Alias');
      expect(message).to.include('Individual Alias');

      // Message should contain every reviewer
      reviewers.map((reviewer) => reviewer.replace('team:', '')).forEach((reviewer) => {
        expect(message).to.include(reviewer);
      });
    });
  });

  describe('post_notification()', function() {
    const createStub = sinon.stub();
    const updateStub = sinon.stub();
    const octokit = {
      issues: {
        createComment: createStub,
        updateComment: updateStub,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = rewired_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      createStub.reset();
      updateStub.reset();
      restoreModule();
    });

    it('empty reviewers and commment', async function() {
      await rewired_github.post_notification([], undefined);

      expect(createStub.callCount).to.be.equal(0);
      expect(updateStub.callCount).to.be.equal(0);
    });

    it('New Missing Reviewers, no comment', async function() {
      const reviewers = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];
      const expectedMessage = rewired_github.get_missing_access_message(reviewers);

      await rewired_github.post_notification(reviewers, undefined);

      expect(createStub.callCount).to.be.equal(1);
      expect(createStub.lastCall.args[0]).to.deep.equal({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        issue_number: 18,
        body: expectedMessage,
      });

      expect(updateStub.callCount).to.be.equal(0);
    });

    it('Existing missing reviewers in comment', async function() {
      const reviewers = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];
      const expectedMessage = rewired_github.get_missing_access_message(reviewers);
      const comment = {
        id: 123,
        body: expectedMessage,
      };

      await rewired_github.post_notification(reviewers, comment);

      expect(createStub.callCount).to.be.equal(0);
      expect(updateStub.callCount).to.be.equal(0);
    });

    it('New Reviewers from original comment', async function() {
      const reviewers = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];
      const commentMessage = rewired_github.get_missing_access_message([ ...reviewers, 'toad' ]);
      const expectedMessage = rewired_github.get_missing_access_message(reviewers);
      const comment = {
        id: 123,
        body: commentMessage,
      };

      await rewired_github.post_notification(reviewers, comment);

      expect(createStub.callCount).to.be.equal(0);
      expect(updateStub.callCount).to.be.equal(1);
      expect(updateStub.lastCall.args[0]).to.deep.equal({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        comment_id: comment.id,
        body: expectedMessage,
      });
    });

    it('Closes old  comment', async function() {
      const reviewers = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];
      const commentMessage = rewired_github.get_missing_access_message(reviewers);

      const comment = {
        id: 123,
        body: commentMessage,
      };

      await rewired_github.post_notification([], comment);

      expect(createStub.callCount).to.be.equal(0);

      expect(updateStub.callCount).to.be.equal(1);
      expect(updateStub.lastCall.args[0].owner).to.deep.equal('necojackarc');
      expect(updateStub.lastCall.args[0].repo).to.deep.equal('auto-request-review');
      expect(updateStub.lastCall.args[0].comment_id).to.deep.equal(comment.id);

      const messageBody = updateStub.lastCall.args[0].body;
      expect(messageBody).to.include(rewired_github.get_comment_footer());
      reviewers.forEach((reviewer) => {
        expect(messageBody).to.not.include(reviewer);
      });
    });

    it('Malformed Comment - Creates New One', async function() {
      const reviewers = [ 'peach', 'team:peach-alliance', 'luigi', 'mario', 'team:bowser-and-co' ];
      const expectedMessage = rewired_github.get_missing_access_message(reviewers);

      // Comment schema has been changed
      const comment = {
        schema: 123,
        message: expectedMessage,
      };

      await rewired_github.post_notification(reviewers, comment);

      expect(createStub.callCount).to.be.equal(1);
      expect(createStub.lastCall.args[0]).to.deep.equal({
        owner: 'necojackarc',
        repo: 'auto-request-review',
        issue_number: 18,
        body: expectedMessage,
      });

      expect(updateStub.callCount).to.be.equal(0);
    });

    it('Malformed Comment - no reviews, skips editing', async function() {
      // Comment schema has been changed
      const comment = {
        schema: 123,
        message: 'This is a robot comment',
      };
      await rewired_github.post_notification([], comment);

      expect(createStub.callCount).to.be.equal(0);
      expect(updateStub.callCount).to.be.equal(0);
    });
  });
});
