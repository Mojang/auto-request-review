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
  const local_github = rewire('../src/github');

  beforeEach(function() {
    local_github.clear_cache();

    const context = ContextStub.build();
    github.context = context;

    sinon.stub(core, 'getInput');
  });

  afterEach(function() {
    core.getInput.restore();
  });

  describe('get_pull_request()', function() {
    it('returns pull request data', function() {
      const pull_request = local_github.get_pull_request();

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
      restoreModule = local_github.__set__('octokit_cache', octokit);
    });

    afterEach(function() {
      restoreModule();
    });

    it('returns a config object', async function() {
      const expected = yaml.parse(Buffer.from(content, encoding).toString());
      const actual = await local_github.fetch_config();
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
      restoreModule = local_github.__set__('octokit_cache', octokit);
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
      const actual = await local_github.fetch_changed_files();
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

      const changed_files = await local_github.fetch_changed_files();
      expect(changed_files).to.have.members(filenames);
    });
  });

  describe('fetch_reviewers()', function() {
    const stub = sinon.stub();
    const octokit = {
      pulls: {
        listRequestedReviewers: stub,
      },
    };

    let restoreModule;
    beforeEach(function() {
      restoreModule = local_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      restoreModule();
    });

    it('fetches current reviewers - user only', async function() {
      stub.returns({
        data: {
          users: [
            { login: 'super/mario/64' },
          ],
          teams: [],
        },
      });
      const expected = [ 'super/mario/64' ];
      const actual = await local_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches current reviewers - team only', async function() {
      stub.returns({
        data: {
          users: [ ],
          teams: [
            { slug: 'super_marios' },
          ],
        },
      });
      const expected = [ 'team:super_marios' ];
      const actual = await local_github.fetch_reviewers();
      expect(actual).to.deep.equal(expected);
    });

    it('fetches current reviewers - combined users and teams', async function() {
      stub.returns({
        data: {
          users: [
            { login: 'bowser' },
            { login: 'peach' },
            { login: 'luigi' },
          ],
          teams: [
            { slug: 'super_marios' },
            { slug: 'toads' },
          ],
        },
      });
      const expected = [ 'bowser', 'peach', 'luigi', 'team:super_marios', 'team:toads' ];
      const actual = await local_github.fetch_reviewers();
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
      restoreModule = local_github.__set__('octokit_cache', octokit);
    });
    afterEach(function() {
      restoreModule();
    });

    it('assigns reviewers', async function() {
      const reviewers = [ 'mario', 'princess-peach', 'team:koopa-troop' ];
      await local_github.assign_reviewers(reviewers);

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
