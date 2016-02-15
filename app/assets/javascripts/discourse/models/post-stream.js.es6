import DiscourseURL from 'discourse/lib/url';
import RestModel from 'discourse/models/rest';
import PostsWithPlaceholders from 'discourse/lib/posts-with-placeholders';
import { default as computed } from 'ember-addons/ember-computed-decorators';
import { loadTopicView } from 'discourse/models/topic';

function calcDayDiff(p1, p2) {
  if (!p1) { return; }

  const date = p1.get('created_at');
  if (date && p2) {
    const lastDate = p2.get('created_at');
    if (lastDate) {
      const delta = new Date(date).getTime() - new Date(lastDate).getTime();
      const days = Math.round(delta / (1000 * 60 * 60 * 24));

      p1.set('daysSincePrevious', days);
    }
  }
}

export default RestModel.extend({
  _identityMap: null,
  posts: null,
  stream: null,
  userFilters: null,
  summary: null,
  loaded: null,
  loadingAbove: null,
  loadingBelow: null,
  loadingFilter: null,
  stagingPost: null,
  postsWithPlaceholders: null,

  init() {
    this._identityMap = {};
    const posts = [];
    const postsWithPlaceholders = PostsWithPlaceholders.create({ posts, store: this.store });

    this.setProperties({
      posts,
      postsWithPlaceholders,
      stream: [],
      userFilters: [],
      summary: false,
      loaded: false,
      loadingAbove: false,
      loadingBelow: false,
      loadingFilter: false,
      stagingPost: false,
    });
  },

  loading: Ember.computed.or('loadingAbove', 'loadingBelow', 'loadingFilter', 'stagingPost'),
  notLoading: Ember.computed.not('loading'),
  filteredPostsCount: Ember.computed.alias("stream.length"),

  @computed('posts.@each')
  hasPosts() {
    return this.get('posts.length') > 0;
  },

  @computed('hasPosts', 'filteredPostsCount')
  hasLoadedData(hasPosts, filteredPostsCount) {
    return hasPosts && filteredPostsCount > 0;
  },

  canAppendMore: Ember.computed.and('notLoading', 'hasPosts', 'lastPostNotLoaded'),
  canPrependMore: Ember.computed.and('notLoading', 'hasPosts', 'firstPostNotLoaded'),

  @computed('hasLoadedData', 'firstPostId', 'posts.@each')
  firstPostPresent(hasLoadedData, firstPostId) {
    if (!hasLoadedData) { return false; }
    return !!this.get('posts').findProperty('id', firstPostId);
  },

  firstPostNotLoaded: Ember.computed.not('firstPostPresent'),
  firstPostId: Ember.computed.alias('stream.firstObject'),
  lastPostId: Ember.computed.alias('stream.lastObject'),

  @computed('hasLoadedData', 'lastPostId', 'posts.@each.id')
  loadedAllPosts(hasLoadedData, lastPostId) {
    if (!hasLoadedData) { return false; }
    if (lastPostId === -1) { return true; }

    return !!this.get('posts').findProperty('id', lastPostId);
  },

  lastPostNotLoaded: Ember.computed.not('loadedAllPosts'),

  /**
    Returns a JS Object of current stream filter options. It should match the query
    params for the stream.
  **/
  @computed('summary', 'show_deleted', 'userFilters.[]')
  streamFilters(summary, showDeleted) {
    const result = {};
    if (summary) { result.filter = "summary"; }
    if (showDeleted) { result.show_deleted = true; }

    const userFilters = this.get('userFilters');
    if (!Ember.isEmpty(userFilters)) {
      result.username_filters = userFilters.join(",");
    }

    return result;
  },

  @computed('streamFilters.[]', 'topic.posts_count', 'posts.length')
  hasNoFilters() {
    const streamFilters = this.get('streamFilters');
    return !(streamFilters && ((streamFilters.filter === 'summary') || streamFilters.username_filters));
  },

  /**
    Returns the window of posts above the current set in the stream, bound to the top of the stream.
    This is the collection we'll ask for when scrolling upwards.
  **/
  @computed('posts.@each', 'stream.@each')
  previousWindow() {
    // If we can't find the last post loaded, bail
    const firstPost = _.first(this.get('posts'));
    if (!firstPost) { return []; }

    // Find the index of the last post loaded, if not found, bail
    const stream = this.get('stream');
    const firstIndex = this.indexOf(firstPost);
    if (firstIndex === -1) { return []; }

    let startIndex = firstIndex - this.get('topic.chunk_size');
    if (startIndex < 0) { startIndex = 0; }
    return stream.slice(startIndex, firstIndex);
  },

  /**
    Returns the window of posts below the current set in the stream, bound by the bottom of the
    stream. This is the collection we use when scrolling downwards.
  **/
  @computed('posts.lastObject', 'stream.@each')
  nextWindow(lastLoadedPost) {
    // If we can't find the last post loaded, bail
    if (!lastLoadedPost) { return []; }

    // Find the index of the last post loaded, if not found, bail
    const stream = this.get('stream');
    const lastIndex = this.indexOf(lastLoadedPost);
    if (lastIndex === -1) { return []; }
    if ((lastIndex + 1) >= this.get('highest_post_number')) { return []; }

    // find our window of posts
    return stream.slice(lastIndex+1, lastIndex + this.get('topic.chunk_size') + 1);
  },

  cancelFilter() {
    this.set('summary', false);
    this.set('show_deleted', false);
    this.get('userFilters').clear();
  },

  toggleSummary() {
    this.get('userFilters').clear();
    this.toggleProperty('summary');

    return this.refresh().then(() => {
      if (this.get('summary')) {
        this.jumpToSecondVisible();
      }
    });
  },

  toggleDeleted() {
    this.toggleProperty('show_deleted');
    return this.refresh();
  },

  jumpToSecondVisible() {
    const posts = this.get('posts');
    if (posts.length > 1) {
      const secondPostNum = posts[1].get('post_number');
      DiscourseURL.jumpToPost(secondPostNum);
    }
  },

  // Filter the stream to a particular user.
  toggleParticipant(username) {
    const userFilters = this.get('userFilters');
    this.set('summary', false);
    this.set('show_deleted', true);

    let jump = false;
    if (userFilters.contains(username)) {
      userFilters.removeObject(username);
    } else {
      userFilters.addObject(username);
      jump = true;
    }
    return this.refresh().then(() => {
      if (jump) {
        this.jumpToSecondVisible();
      }
    });
  },

  /**
    Loads a new set of posts into the stream. If you provide a `nearPost` option and the post
    is already loaded, it will simply scroll there and load nothing.
  **/
  refresh(opts) {
    opts = opts || {};
    opts.nearPost = parseInt(opts.nearPost, 10);

    const topic = this.get('topic');

    // Do we already have the post in our list of posts? Jump there.
    if (opts.forceLoad) {
      this.set('loaded', false);
    } else {
      const postWeWant = this.get('posts').findProperty('post_number', opts.nearPost);
      if (postWeWant) { return Ember.RSVP.resolve(); }
    }

    // TODO: if we have all the posts in the filter, don't go to the server for them.
    this.set('loadingFilter', true);

    opts = _.merge(opts, this.get('streamFilters'));

    // Request a topicView
    return loadTopicView(topic, opts).then(json => {
      this.updateFromJson(json.post_stream);
      this.setProperties({ loadingFilter: false, loaded: true });
    }).catch(result => {
      this.errorLoading(result);
      throw result;
    });
  },

  collapsePosts(from, to){
    const posts = this.get('posts');
    const remove = posts.filter(post => {
      const postNumber = post.get('post_number');
      return postNumber >= from && postNumber <= to;
    });

    posts.removeObjects(remove);

    // make gap
    this.set('gaps', this.get('gaps') || {before: {}, after: {}});
    const before = this.get('gaps.before');
    const post = posts.find(p => p.get('post_number') > to);

    before[post.get('id')] = remove.map(p => p.get('id'));
    post.set('hasGap', true);

    this.get('stream').enumerableContentDidChange();
  },

  // Fill in a gap of posts before a particular post
  fillGapBefore(post, gap) {
    const postId = post.get('id'),
          stream = this.get('stream'),
          idx = stream.indexOf(postId),
          currentPosts = this.get('posts');

    if (idx !== -1) {
      // Insert the gap at the appropriate place
      stream.splice.apply(stream, [idx, 0].concat(gap));

      let postIdx = currentPosts.indexOf(post);
      const origIdx = postIdx;
      if (postIdx !== -1) {
        return this.findPostsByIds(gap).then(posts => {
          posts.forEach(p => {
            const stored = this.storePost(p);
            if (!currentPosts.contains(stored)) {
              currentPosts.insertAt(postIdx++, stored);
            }
          });

          delete this.get('gaps.before')[postId];
          this.get('stream').enumerableContentDidChange();
          this.get('postsWithPlaceholders').arrayContentDidChange(origIdx, 0, posts.length);
          post.set('hasGap', false);
        });
      }
    }
    return Ember.RSVP.resolve();
  },

  // Fill in a gap of posts after a particular post
  fillGapAfter(post, gap) {
    const postId = post.get('id'),
          stream = this.get('stream'),
          idx = stream.indexOf(postId);

    if (idx !== -1) {
      stream.pushObjects(gap);
      return this.appendMore().then(() => {
        this.get('stream').enumerableContentDidChange();
      });
    }
    return Ember.RSVP.resolve();
  },

  // Appends the next window of posts to the stream. Call it when scrolling downwards.
  appendMore() {
    // Make sure we can append more posts
    if (!this.get('canAppendMore')) { return Ember.RSVP.resolve(); }

    const postIds = this.get('nextWindow');
    if (Ember.isEmpty(postIds)) { return Ember.RSVP.resolve(); }

    this.set('loadingBelow', true);
    const postsWithPlaceholders = this.get('postsWithPlaceholders');
    postsWithPlaceholders.appending(postIds);
    return this.findPostsByIds(postIds).then(posts => {
      posts.forEach(p => this.appendPost(p));
      return posts;
    }).finally(() => {
      postsWithPlaceholders.finishedAppending(postIds);
      this.set('loadingBelow', false);
    });
  },

  // Prepend the previous window of posts to the stream. Call it when scrolling upwards.
  prependMore() {
    // Make sure we can append more posts
    if (!this.get('canPrependMore')) { return Ember.RSVP.resolve(); }

    const postIds = this.get('previousWindow');
    if (Ember.isEmpty(postIds)) { return Ember.RSVP.resolve(); }

    this.set('loadingAbove', true);
    return this.findPostsByIds(postIds.reverse()).then(posts => {
      posts.forEach(p => this.prependPost(p));
    }).finally(() => {
      const postsWithPlaceholders = this.get('postsWithPlaceholders');
      postsWithPlaceholders.finishedPrepending(postIds);
      this.set('loadingAbove', false);
    });
  },

  /**
    Stage a post for insertion in the stream. It should be rendered right away under the
    assumption that the post will succeed. We can then `commitPost` when it succeeds or
    `undoPost` when it fails.
  **/
  stagePost(post, user) {
    // We can't stage two posts simultaneously
    if (this.get('stagingPost')) { return "alreadyStaging"; }

    this.set('stagingPost', true);

    const topic = this.get('topic');
    topic.setProperties({
      posts_count: (topic.get('posts_count') || 0) + 1,
      last_posted_at: new Date(),
      'details.last_poster': user,
      highest_post_number: (topic.get('highest_post_number') || 0) + 1
    });

    post.setProperties({
      post_number: topic.get('highest_post_number'),
      topic: topic,
      created_at: new Date(),
      id: -1
    });

    // If we're at the end of the stream, add the post
    if (this.get('loadedAllPosts')) {
      this.appendPost(post);
      this.get('stream').addObject(post.get('id'));
      return "staged";
    }

    return "offScreen";
  },

  // Commit the post we staged. Call this after a save succeeds.
  commitPost(post) {

    if (this.get('topic.id') === post.get('topic_id')) {
      if (this.get('loadedAllPosts')) {
        this.appendPost(post);
        this.get('stream').addObject(post.get('id'));
      }
    }

    this.get('stream').removeObject(-1);
    this._identityMap[-1] = null;
    this.set('stagingPost', false);
  },

  /**
    Undo a post we've staged in the stream. Remove it from being rendered and revert the
    state we changed.
  **/
  undoPost(post) {
    this.get('stream').removeObject(-1);
    this.get('postsWithPlaceholders').removePost(() => this.posts.removeObject(post));
    this._identityMap[-1] = null;

    const topic = this.get('topic');
    this.set('stagingPost', false);

    topic.setProperties({
      highest_post_number: (topic.get('highest_post_number') || 0) - 1,
      posts_count: (topic.get('posts_count') || 0) - 1
    });

    // TODO unfudge reply count on parent post
  },

  prependPost(post) {
    const stored = this.storePost(post);
    if (stored) {
      const posts = this.get('posts');
      calcDayDiff(posts.get('firstObject'), stored);
      posts.unshiftObject(stored);
    }

    return post;
  },

  appendPost(post) {
    const stored = this.storePost(post);
    if (stored) {
      const posts = this.get('posts');

      calcDayDiff(stored, this.get('lastAppended'));
      if (!posts.contains(stored)) {
        if (!this.get('loadingBelow')) {
          this.get('postsWithPlaceholders').appendPost(() => posts.pushObject(stored));
        } else {
          posts.pushObject(stored);
        }
      }

      if (stored.get('id') !== -1) {
        this.set('lastAppended', stored);
      }
    }
    return post;
  },

  removePosts(posts) {
    if (Ember.isEmpty(posts)) { return; }

    const postIds = posts.map(p => p.get('id'));
    const identityMap = this._identityMap;

    this.get('stream').removeObjects(postIds);
    this.get('posts').removeObjects(posts);
    postIds.forEach(id => delete identityMap[id]);
  },

  // Returns a post from the identity map if it's been inserted.
  findLoadedPost(id) {
    return this._identityMap[id];
  },

  loadPost(postId){
    const url = "/posts/" + postId;
    const store = this.store;

    return Discourse.ajax(url).then(p => this.storePost(store.createRecord('post', p)));
  },

  /**
    Finds and adds a post to the stream by id. Typically this would happen if we receive a message
    from the message bus indicating there's a new post. We'll only insert it if we currently
    have no filters.
  **/
  triggerNewPostInStream(postId) {
    if (!postId) { return; }

    // We only trigger if there are no filters active
    if (!this.get('hasNoFilters')) { return; }

    const loadedAllPosts = this.get('loadedAllPosts');

    if (this.get('stream').indexOf(postId) === -1) {
      this.get('stream').addObject(postId);
      if (loadedAllPosts) {
        this.set('loadingLastPost', true);
        this.findPostsByIds([postId]).then(posts => {
          posts.forEach(p => this.appendPost(p));
        }).finally(() => {
          this.set('loadingLastPost', false);
        });
      }
    }
  },

  triggerRecoveredPost(postId) {
    const existing = this._identityMap[postId];

    if (existing) {
      this.triggerChangedPost(postId, new Date());
    } else {
      // need to insert into stream
      const url = "/posts/" + postId;
      const store = this.store;
      Discourse.ajax(url).then(p => {
        const post = store.createRecord('post', p);
        const stream = this.get("stream");
        const posts = this.get("posts");
        this.storePost(post);

        // we need to zip this into the stream
        let index = 0;
        stream.forEach(pid => {
          if (pid < p.id) {
            index+= 1;
          }
        });

        stream.insertAt(index, p.id);

        index = 0;
        posts.forEach(_post => {
          if (_post.id < p.id) {
            index+= 1;
          }
        });

        if (index < posts.length) {
          posts.insertAt(index, post);
        } else {
          if (post.post_number < posts[posts.length-1].post_number + 5) {
            this.appendMore();
          }
        }
      });
    }
  },

  triggerDeletedPost(postId){
    const existing = this._identityMap[postId];

    if (existing) {
      const url = "/posts/" + postId;
      const store = this.store;

      Discourse.ajax(url).then(p => {
        this.storePost(store.createRecord('post', p));
      }).catch(() => {
        this.removePosts([existing]);
      });
    }
  },

  triggerChangedPost(postId, updatedAt) {
    if (!postId) { return; }

    const existing = this._identityMap[postId];
    if (existing && existing.updated_at !== updatedAt) {
      const url = "/posts/" + postId;
      const store = this.store;
      Discourse.ajax(url).then(p => this.storePost(store.createRecord('post', p)));
    }
  },

  // Returns the "thread" of posts in the history of a post.
  findReplyHistory(post) {
    const url = `/posts/${post.get('id')}/reply-history.json?max_replies=${Discourse.SiteSettings.max_reply_history}`;
    const store = this.store;
    return Discourse.ajax(url).then(result => {
      return result.map(p => this.storePost(store.createRecord('post', p)));
    }).then(replyHistory => {
      post.set('replyHistory', replyHistory);
    });
  },

  /**
    Returns the closest post given a postNumber that may not exist in the stream.
    For example, if the user asks for a post that's deleted or otherwise outside the range.
    This allows us to set the progress bar with the correct number.
  **/
  closestPostForPostNumber(postNumber) {
    if (!this.get('hasPosts')) { return; }

    let closest = null;
    this.get('posts').forEach(p => {
      if (!closest) {
        closest = p;
        return;
      }

      if (Math.abs(postNumber - p.get('post_number')) < Math.abs(closest.get('post_number') - postNumber)) {
        closest = p;
      }
    });

    return closest;
  },

  // Get the index of a post in the stream. (Use this for the topic progress bar.)
  progressIndexOfPost(post) {
    return this.progressIndexOfPostId(post.get('id'));
  },

  // Get the index in the stream of a post id. (Use this for the topic progress bar.)
  progressIndexOfPostId(postId) {
    return this.get('stream').indexOf(postId) + 1;
  },

  /**
    Returns the closest post number given a postNumber that may not exist in the stream.
    For example, if the user asks for a post that's deleted or otherwise outside the range.
    This allows us to set the progress bar with the correct number.
  **/
  closestPostNumberFor(postNumber) {
    if (!this.get('hasPosts')) { return; }

    let closest = null;
    this.get('posts').forEach(p => {
      if (closest === postNumber) { return; }
      if (!closest) { closest = p.get('post_number'); }

      if (Math.abs(postNumber - p.get('post_number')) < Math.abs(closest - postNumber)) {
        closest = p.get('post_number');
      }
    });

    return closest;
  },

  // Find a postId for a postNumber, respecting gaps
  findPostIdForPostNumber(postNumber) {
    const stream = this.get('stream'),
          beforeLookup = this.get('gaps.before'),
          streamLength = stream.length;

    let sum = 1;
    for (let i=0; i<streamLength; i++) {
      const pid = stream[i];

      // See if there are posts before this post
      if (beforeLookup) {
        const before = beforeLookup[pid];
        if (before) {
          for (let j=0; j<before.length; j++) {
            if (sum === postNumber) { return pid; }
            sum++;
          }
        }
      }

      if (sum === postNumber) { return pid; }
      sum++;
    }
  },

  updateFromJson(postStreamData) {
    const posts = this.get('posts');

    const postsWithPlaceholders = this.get('postsWithPlaceholders');
    postsWithPlaceholders.clear(() => posts.clear());

    this.set('gaps', null);
    if (postStreamData) {
      // Load posts if present
      const store = this.store;
      postStreamData.posts.forEach(p => this.appendPost(store.createRecord('post', p)));
      delete postStreamData.posts;

      // Update our attributes
      this.setProperties(postStreamData);
    }
  },

  /**
    Stores a post in our identity map, and sets up the references it needs to
    find associated objects like the topic. It might return a different reference
    than you supplied if the post has already been loaded.
  **/
  storePost(post) {
    // Calling `Ember.get(undefined)` raises an error
    if (!post) { return; }

    const postId = Ember.get(post, 'id');
    if (postId) {
      const existing = this._identityMap[post.get('id')];

      // Update the `highest_post_number` if this post is higher.
      const postNumber = post.get('post_number');
      if (postNumber && postNumber > (this.get('topic.highest_post_number') || 0)) {
        this.set('topic.highest_post_number', postNumber);
      }

      if (existing) {
        // If the post is in the identity map, update it and return the old reference.
        existing.updateFromPost(post);
        return existing;
      }

      post.set('topic', this.get('topic'));
      this._identityMap[post.get('id')] = post;
    }
    return post;
  },

  findPostsByIds(postIds) {
    const identityMap = this._identityMap;
    const unloaded = postIds.filter(p => !identityMap[p]);

    // Load our unloaded posts by id
    return this.loadIntoIdentityMap(unloaded).then(() => {
      return postIds.map(p => identityMap[p]).compact();
    });
  },

  loadIntoIdentityMap(postIds) {
    if (Ember.isEmpty(postIds)) { return Ember.RSVP.resolve([]); }

    const url = "/t/" + this.get('topic.id') + "/posts.json";
    const data = { post_ids: postIds };
    const store = this.store;
    return Discourse.ajax(url, {data}).then(result => {
      const posts = Ember.get(result, "post_stream.posts");
      if (posts) {
        posts.forEach(p => this.storePost(store.createRecord('post', p)));
      }
    });
  },

  indexOf(post) {
    return this.get('stream').indexOf(post.get('id'));
  },

  // Handles an error loading a topic based on a HTTP status code. Updates
  // the text to the correct values.
  errorLoading(result) {
    const status = result.jqXHR.status;

    const topic = this.get('topic');
    this.set('loadingFilter', false);
    topic.set('errorLoading', true);

    // If the result was 404 the post is not found
    // If it was 410 the post is deleted and the user should not see it
    if (status === 404 || status === 410) {
      topic.set('notFoundHtml', result.jqXHR.responseText);
      return;
    }

    // If the result is 403 it means invalid access
    if (status === 403) {
      topic.set('noRetry', true);
      if (Discourse.User.current()) {
        topic.set('message', I18n.t('topic.invalid_access.description'));
      } else {
        topic.set('message', I18n.t('topic.invalid_access.login_required'));
      }
      return;
    }

    // Otherwise supply a generic error message
    topic.set('message', I18n.t('topic.server_error.description'));
  }
});
