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
});
