import ModalFunctionality from 'discourse/mixins/modal-functionality';
import { categoryBadgeHTML } from 'discourse/helpers/category-link';
import computed from 'ember-addons/ember-computed-decorators';
import { propertyGreaterThan, propertyLessThan } from 'discourse/lib/computed';

// This controller handles displaying of history
export default Ember.Controller.extend(ModalFunctionality, {
  loading: true,
  viewMode: "side_by_side",
  revisionsTextKey: "post.revisions.controls.comparing_previous_to_current_out_of_total",

  _changeViewModeOnMobile: function() {
    if (Discourse.Mobile.mobileView) { this.set("viewMode", "inline"); }
  }.on("init"),

  refresh(postId, postVersion) {
    this.set("loading", true);

    Discourse.Post.loadRevision(postId, postVersion).then(result => {
      this.setProperties({ loading: false, model: result });
    });
  },

  hide(postId, postVersion) {
    Discourse.Post.hideRevision(postId, postVersion).then(() => this.refresh(postId, postVersion));
  },

  show(postId, postVersion) {
    Discourse.Post.showRevision(postId, postVersion).then(() => this.refresh(postId, postVersion));
  },

  @computed('model.created_at')
  createdAtDate(createdAt) {
    return moment(createdAt).format("LLLL");
  },

  @computed('model.current_version')
  previousVersion(current) {
    return current - 1;
  },

  @computed('model.current_revision', 'model.previous_revision')
  displayGoToPrevious(current, prev) {
    return prev && current > prev;
  },

  displayRevisions: Ember.computed.gt("model.version_count", 2),
  displayGoToFirst: propertyGreaterThan("model.current_revision", "model.first_revision"),
  displayGoToNext: propertyLessThan("model.current_revision", "model.next_revision"),
  displayGoToLast: propertyLessThan("model.current_revision", "model.next_revision"),

  hideGoToFirst: Ember.computed.not("displayGoToFirst"),
  hideGoToPrevious: Ember.computed.not("displayGoToPrevious"),
  hideGoToNext: Ember.computed.not("displayGoToNext"),
  hideGoToLast: Ember.computed.not("displayGoToLast"),

  loadFirstDisabled: Ember.computed.or("loading", "hideGoToFirst"),
  loadPreviousDisabled: Ember.computed.or("loading", "hideGoToPrevious"),
  loadNextDisabled: Ember.computed.or("loading", "hideGoToNext"),
  loadLastDisabled: Ember.computed.or("loading", "hideGoToLast"),

  @computed('model.previous_hidden')
  displayShow(prevHidden) {
    return prevHidden && this.currentUser && this.currentUser.get('staff');
  },

  @computed('model.previous_hidden')
  displayHide(prevHidden) {
    return !prevHidden && this.currentUser && this.currentUser.get('staff');
  },

  isEitherRevisionHidden: Ember.computed.or("model.previous_hidden", "model.current_hidden"),

  @computed('model.previous_hidden', 'model.current_hidden', 'displayingInline')
  hiddenClasses(prevHidden, currentHidden, displayingInline) {
    if (displayingInline) {
      return this.get("isEitherRevisionHidden") ? "hidden-revision-either" : null;
    } else {
      var result = [];
      if (prevHidden) { result.push("hidden-revision-previous"); }
      if (currentHidden) { result.push("hidden-revision-current"); }
      return result.join(" ");
    }
  },

  displayingInline: Em.computed.equal("viewMode", "inline"),
  displayingSideBySide: Em.computed.equal("viewMode", "side_by_side"),
  displayingSideBySideMarkdown: Em.computed.equal("viewMode", "side_by_side_markdown"),

  @computed("displayingInline")
  inlineClass(displayingInline) { return displayingInline ? "btn-primary" : ""; },

  @computed("displayingSideBySide")
  sideBySideClass(displayingSideBySide) { return displayingSideBySide ? "btn-primary" : ""; },

  @computed("displayingSideBySideMarkdown")
  sideBySideMarkdownClass(displayingSideBySideMarkdown) { return displayingSideBySideMarkdown ? "btn-primary" : ""; },

  @computed('model.category_id_changes')
  previousCategory(changes) {
    if (changes) {
      var category = Discourse.Category.findById(changes["previous"]);
      return categoryBadgeHTML(category, { allowUncategorized: true });
    }
  },

  @computed('model.category_id_changes')
  currentCategory(changes) {
    if (changes) {
      var category = Discourse.Category.findById(changes["current"]);
      return categoryBadgeHTML(category, { allowUncategorized: true });
    }
  },

  @computed('model.wiki_changes')
  wikiDisabled(changes) {
    return changes && !changes['current'];
  },

  @computed('model.post_type_changes')
  postTypeDisabled(changes) {
    return (changes && changes['current'] !== this.site.get('post_types.moderator_action'));
  },

  @computed('viewMode', 'model.title_changes')
  titleDiff(viewMode) {
    if (viewMode === "side_by_side_markdown") { viewMode = "side_by_side"; }
    return this.get("model.title_changes." + viewMode);
  },

  @computed('viewMode', 'model.body_changes')
  bodyDiff(viewMode) {
    return this.get("model.body_changes." + viewMode);
  },

  actions: {
    loadFirstVersion()    { this.refresh(this.get("model.post_id"), this.get("model.first_revision")); },
    loadPreviousVersion() { this.refresh(this.get("model.post_id"), this.get("model.previous_revision")); },
    loadNextVersion()     { this.refresh(this.get("model.post_id"), this.get("model.next_revision")); },
    loadLastVersion()     { this.refresh(this.get("model.post_id"), this.get("model.last_revision")); },

    hideVersion() { this.hide(this.get("model.post_id"), this.get("model.current_revision")); },
    showVersion() { this.show(this.get("model.post_id"), this.get("model.current_revision")); },

    displayInline()             { this.set("viewMode", "inline"); },
    displaySideBySide()         { this.set("viewMode", "side_by_side"); },
    displaySideBySideMarkdown() { this.set("viewMode", "side_by_side_markdown"); }
  }
});
