import DiscourseContainerView from 'discourse/views/container';

export default DiscourseContainerView.extend({
  metaDataBinding: 'parentView.metaData',

  init: function() {
    this._super();
    var metaData = this.get('metaData');
    var archetypeOptionsView = this;
    return this.get('archetype.options').forEach(function(a) {
      if (a.option_type === 1) {
        archetypeOptionsView.attachViewWithArgs({
          content: a,
          checked: metaData.get(a.key) === 'true'
        }, Discourse.OptionBooleanView);
      }

    });
  }
});
