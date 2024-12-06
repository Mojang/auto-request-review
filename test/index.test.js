'use strict';

const core = require('@actions/core');
const github = require('../src/github');
const sinon = require('sinon');
const { expect } = require('chai');

const { run, clear_cache } = require('../src/index');

describe('index', function() {
  describe('run()', function() {
    beforeEach(function() {
      clear_cache();
      github.clear_cache();

      sinon.stub(github, 'fetch_config');
      sinon.stub(github, 'get_pull_request');
      sinon.stub(github, 'fetch_changed_files');
      sinon.stub(github, 'fetch_reviewers');
      sinon.stub(github, 'filter_only_collaborators');
      sinon.stub(github, 'assign_reviewers');
      sinon.stub(github, 'get_existing_comment');
      sinon.stub(github, 'post_notification');

      sinon.stub(core, 'getInput');
    });

    afterEach(function() {
      github.fetch_config.restore();
      github.get_pull_request.restore();
      github.fetch_changed_files.restore();
      github.fetch_reviewers.restore();
      github.filter_only_collaborators.restore();
      github.assign_reviewers.restore();
      github.get_existing_comment.restore();
      github.post_notification.restore();

      core.getInput.restore();
    });

    it('requests review based on files changed', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'princess-peach' ],
          '**/*.rb': [ 'wario', 'waluigi' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario', 'princess-peach' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('skips single alias if already a reviewer', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'princess-peach' ],
          '**/*.rb': [ 'wario', 'waluigi' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ 'princess-peach' ];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('skips team alias if already a reviewer', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js', 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ 'team:bowser-and-co' ];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario', 'team:peach-alliance', 'wario', 'waluigi' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('skips calling assign if no reviewers', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'princess-peach' ],
          '**/*.rb': [ 'wario', 'waluigi' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ 'princess-peach', 'mario' ];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.notCalled).to.be.true;

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('removes non collaborators - individual', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'princess-peach' ],
          '**/*.rb': [ 'wario', 'waluigi' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ ];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario' ];
      const missing_access = [ 'princess-peach' ];
      github.filter_only_collaborators.returns([ collaborators, missing_access ]);

      const comment = { id: 123, body: 'test comment' };
      github.get_existing_comment.returns(comment);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members([ 'mario', 'princess-peach' ]);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.calledOnce).to.be.true;
      expect(github.post_notification.lastCall.args[0]).to.have.members(missing_access);
      expect(github.post_notification.lastCall.args[1]).to.deep.equal(comment);
    });

    it('removes non collaborators - team', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js', 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ ];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'team:peach-alliance' ];
      const missing_access = [ 'mario', 'wario', 'waluigi', 'team:bowser-and-co' ];
      github.filter_only_collaborators.returns([ collaborators, missing_access ]);

      const comment = { id: 123, body: 'test comment' };
      github.get_existing_comment.returns(comment);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members([ 'team:peach-alliance' ]);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members([ 'mario', 'team:peach-alliance', 'wario', 'waluigi', 'team:bowser-and-co' ]);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.calledOnce).to.be.true;
      expect(github.post_notification.lastCall.args[0]).to.have.members(missing_access);
      expect(github.post_notification.lastCall.args[1]).to.deep.equal(comment);
    });

    it('removes non collaborators + previous review mix', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.js', 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ 'waluigi', 'team:peach-alliance' ];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario', 'team:bowser-and-co' ];
      const missing_access = [ 'wario' ];
      github.filter_only_collaborators.returns([ collaborators, missing_access ]);

      const comment = { id: 123, body: 'test comment' };
      github.get_existing_comment.returns(comment);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members([ 'mario', 'wario', 'team:bowser-and-co' ]);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.calledOnce).to.be.true;
      expect(github.post_notification.lastCall.args[0]).to.have.members(missing_access);
      expect(github.post_notification.lastCall.args[1]).to.deep.equal(comment);
    });

    it('requests review based on groups that author belongs to', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'dr-mario', 'luigi' ],
            'mario-alike': [ 'mario', 'dr-mario', 'wario' ],
          },
        },
        options: {
          enable_group_assignment: true,
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario', 'dr-mario' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('does not request review with "ignore_draft" true if a pull request is a draft', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
        },
        options: {
          ignore_draft: true,
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: true,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      await run();

      expect(github.fetch_changed_files.notCalled).to.be.true;
      expect(github.fetch_reviewers.notCalled).to.be.true;
      expect(github.filter_only_collaborators.notCalled).to.be.true;
      expect(github.assign_reviewers.notCalled).to.be.true;
      expect(github.get_existing_comment.notCalled).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('does not request review if a pull request title contains any of "ignored_keywords"', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
        },
        options: {
          ignored_keywords: [ 'NOT NICE' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: '[NOT NICE] Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      await run();

      expect(github.fetch_changed_files.notCalled).to.be.true;
      expect(github.fetch_reviewers.notCalled).to.be.true;
      expect(github.filter_only_collaborators.notCalled).to.be.true;
      expect(github.assign_reviewers.notCalled).to.be.true;
      expect(github.get_existing_comment.notCalled).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('does not request review if no reviewers are matched and default reviweres are not set', async function() {
      const config = {
        reviewers: {
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'princess-peach' ],
          '**/*.rb': [ 'wario', 'waluigi' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.py' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.filter_only_collaborators.notCalled).to.be.true;
      expect(github.assign_reviewers.notCalled).to.be.true;
      expect(github.get_existing_comment.notCalled).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('requests review to the default reviewers if no reviewers are matched', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario', 'mario-brothers' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'princess-peach' ],
          '**/*.rb': [ 'wario', 'waluigi' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.py' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'dr-mario', 'mario' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('requests review based on reviewers per author', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'dr-mario', 'luigi' ],
            'mario-alike': [ 'mario', 'dr-mario', 'wario' ],
          },
          per_author: {
            luigi: [ 'mario', 'waluigi' ],
          },
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario', 'waluigi' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('requests review based on reviewers per author when a group is used as an auther setting', async function() {
      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'dr-mario', 'luigi' ],
            'mario-alike': [ 'mario', 'dr-mario', 'wario' ],
          },
          per_author: {
            'mario-brothers': [ 'mario-brothers', 'waluigi' ],
          },
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'mario', 'dr-mario', 'waluigi' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('limits the number of reviewers based on number_of_reviewers setting', async function() {
      const config = {
        reviewers: {
          per_author: {
            luigi: [ 'dr-mario', 'mario', 'waluigi' ],
          },
        },
        options: {
          number_of_reviewers: 2,
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [];
      github.fetch_reviewers.returns(current_reviewers);

      const collaborators = [ 'dr-mario', 'mario', 'waluigi' ];
      github.filter_only_collaborators.returns([ collaborators, [] ]);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      const randomly_picked_reviewers = github.assign_reviewers.lastCall.args[0];
      expect([ 'dr-mario', 'mario', 'waluigi' ]).to.include.members(randomly_picked_reviewers);
      expect(new Set(randomly_picked_reviewers)).to.have.lengthOf(2);

      expect(github.filter_only_collaborators.calledOnce).to.be.true;
      expect(github.filter_only_collaborators.lastCall.args[0]).to.have.members(collaborators);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('Validate Mode - Adds To Non Collaborators', async function() {
      core.getInput.withArgs('validate_all').returns('true');

      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ ];
      github.fetch_reviewers.returns(current_reviewers);

      // Initial filter from the file.rb file change
      const first_filter_args = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const collaborators = [ 'waluigi', 'team:bowser-and-co' ];
      const missing_access = [ 'wario' ];
      github.filter_only_collaborators.withArgs(first_filter_args).returns([ collaborators, missing_access ]);

      // Second filter after validate all has been called
      const second_filter_args = [ 'dr-mario', 'mario', 'luigi', 'team:peach-alliance' ];
      const collaborators_second = [ 'dr-mario', 'luigi', 'team:peach-alliance' ];
      const missing_access_second = [ 'mario' ];
      github.filter_only_collaborators.withArgs(second_filter_args).returns([ collaborators_second, missing_access_second ]);

      const comment = { id: 123, body: 'test comment' };
      github.get_existing_comment.returns(comment);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(core.getInput.withArgs('validate_all').calledOnce).to.be.true;
      expect(github.filter_only_collaborators.calledTwice).to.be.true;
      expect(github.filter_only_collaborators.firstCall.args[0]).to.have.members(first_filter_args);
      expect(github.filter_only_collaborators.secondCall.args[0]).to.have.members(second_filter_args);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.calledOnce).to.be.true;
      expect(github.post_notification.lastCall.args[0]).to.have.members([ ...missing_access, ...missing_access_second ]);
      expect(github.post_notification.lastCall.args[1]).to.deep.equal(comment);
    });

    it('Validate Mode - Posts without original missing access', async function() {
      core.getInput.withArgs('validate_all').returns('true');

      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ ];
      github.fetch_reviewers.returns(current_reviewers);

      // Initial filter from the file.rb file change
      const first_filter_args = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const collaborators = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const missing_access = [ ];
      github.filter_only_collaborators.withArgs(first_filter_args).returns([ collaborators, missing_access ]);

      // Second filter after validate all has been called
      const second_filter_args = [ 'dr-mario', 'mario', 'luigi', 'team:peach-alliance' ];
      const collaborators_second = [ 'dr-mario', 'luigi', 'team:peach-alliance' ];
      const missing_access_second = [ 'mario' ];
      github.filter_only_collaborators.withArgs(second_filter_args).returns([ collaborators_second, missing_access_second ]);

      const comment = { id: 123, body: 'test comment' };
      github.get_existing_comment.returns(comment);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(core.getInput.withArgs('validate_all').calledOnce).to.be.true;
      expect(github.filter_only_collaborators.calledTwice).to.be.true;
      expect(github.filter_only_collaborators.firstCall.args[0]).to.have.members(first_filter_args);
      expect(github.filter_only_collaborators.secondCall.args[0]).to.have.members(second_filter_args);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.calledOnce).to.be.true;
      expect(github.post_notification.lastCall.args[0]).to.have.members(missing_access_second);
      expect(github.post_notification.lastCall.args[1]).to.deep.equal(comment);
    });

    it('Validate Mode - Good State - No Comment', async function() {
      core.getInput.withArgs('validate_all').returns('true');

      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ ];
      github.fetch_reviewers.returns(current_reviewers);

      // Initial filter from the file.rb file change
      const first_filter_args = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const collaborators = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const missing_access = [ ];
      github.filter_only_collaborators.withArgs(first_filter_args).returns([ collaborators, missing_access ]);

      // Second filter after validate all has been called
      const second_filter_args = [ 'dr-mario', 'mario', 'luigi', 'team:peach-alliance' ];
      const collaborators_second = [ 'dr-mario', 'mario', 'luigi', 'team:peach-alliance' ];
      const missing_access_second = [ ];
      github.filter_only_collaborators.withArgs(second_filter_args).returns([ collaborators_second, missing_access_second ]);

      github.get_existing_comment.returns(undefined);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(core.getInput.withArgs('validate_all').calledOnce).to.be.true;
      expect(github.filter_only_collaborators.calledTwice).to.be.true;
      expect(github.filter_only_collaborators.firstCall.args[0]).to.have.members(first_filter_args);
      expect(github.filter_only_collaborators.secondCall.args[0]).to.have.members(second_filter_args);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.notCalled).to.be.true;
    });

    it('Validate Mode - Good State - Comment', async function() {
      core.getInput.withArgs('validate_all').returns('true');

      const config = {
        reviewers: {
          defaults: [ 'dr-mario' ],
          groups: {
            'mario-brothers': [ 'mario', 'luigi' ],
          },
        },
        files: {
          '**/*.js': [ 'mario-brothers', 'team:peach-alliance' ],
          '**/*.rb': [ 'wario', 'waluigi', 'team:bowser-and-co' ],
        },
      };
      github.fetch_config.returns(config);

      const pull_request = {
        title: 'Nice Pull Request',
        is_draft: false,
        author: 'luigi',
      };
      github.get_pull_request.returns(pull_request);

      const changed_files = [ 'path/to/file.rb' ];
      github.fetch_changed_files.returns(changed_files);

      const current_reviewers = [ ];
      github.fetch_reviewers.returns(current_reviewers);

      // Initial filter from the file.rb file change
      const first_filter_args = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const collaborators = [ 'wario', 'waluigi', 'team:bowser-and-co' ];
      const missing_access = [ ];
      github.filter_only_collaborators.withArgs(first_filter_args).returns([ collaborators, missing_access ]);

      // Second filter after validate all has been called
      const second_filter_args = [ 'dr-mario', 'mario', 'luigi', 'team:peach-alliance' ];
      const collaborators_second = [ 'dr-mario', 'mario', 'luigi', 'team:peach-alliance' ];
      const missing_access_second = [ ];
      github.filter_only_collaborators.withArgs(second_filter_args).returns([ collaborators_second, missing_access_second ]);

      const comment = { id: 123, body: 'test comment' };
      github.get_existing_comment.returns(comment);

      await run();

      expect(github.assign_reviewers.calledOnce).to.be.true;
      expect(github.assign_reviewers.lastCall.args[0]).to.have.members(collaborators);

      expect(core.getInput.withArgs('validate_all').calledOnce).to.be.true;
      expect(github.filter_only_collaborators.calledTwice).to.be.true;
      expect(github.filter_only_collaborators.firstCall.args[0]).to.have.members(first_filter_args);
      expect(github.filter_only_collaborators.secondCall.args[0]).to.have.members(second_filter_args);

      expect(github.get_existing_comment.calledOnce).to.be.true;
      expect(github.post_notification.calledOnce).to.be.true;
      expect(github.post_notification.lastCall.args[0]).to.have.members([]);
      expect(github.post_notification.lastCall.args[1]).to.deep.equal(comment);
    });
  });
});
