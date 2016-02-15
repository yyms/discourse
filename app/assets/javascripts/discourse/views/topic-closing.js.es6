import StringBuffer from 'discourse/mixins/string-buffer';

export default Ember.View.extend(StringBuffer, {
  elementId: 'topic-closing-info',
  delayedRerender: null,

  rerenderTriggers: ['topic.closed',
                     'topic.details.auto_close_at',
                     'topic.details.auto_close_based_on_last_post',
                     'topic.details.auto_close_hours'],

  renderString: function(buffer) {
    if (!!Ember.isEmpty(this.get('topic.details.auto_close_at'))) return;
    if (this.get("topic.closed")) return;

    var autoCloseAt = moment(this.get('topic.details.auto_close_at'));
    if (autoCloseAt < new Date()) return;

    var duration = moment.duration(autoCloseAt - moment());
    var minutesLeft = duration.asMinutes();
    var timeLeftString = duration.humanize(true);
    var rerenderDelay = 1000;

    if (minutesLeft > 2160) {
      rerenderDelay = 12 * 60 * 60000;
    } else if (minutesLeft > 1410) {
      rerenderDelay = 60 * 60000;
    } else if (minutesLeft > 90) {
      rerenderDelay = 30 * 60000;
    } else if (minutesLeft > 2) {
      rerenderDelay = 60000;
    }

    var basedOnLastPost = this.get("topic.details.auto_close_based_on_last_post");
    var key = basedOnLastPost ? 'topic.auto_close_notice_based_on_last_post' : 'topic.auto_close_notice';
    var autoCloseHours = this.get("topic.details.auto_close_hours") || 0;

    buffer.push('<h3><i class="fa fa-clock-o"></i> ');
    buffer.push( I18n.t(key, { timeLeft: timeLeftString, duration: moment.duration(autoCloseHours, "hours").humanize() }) );
    buffer.push('</h3>');

    // TODO Sam: concerned this can cause a heavy rerender loop
    this.set('delayedRerender', Em.run.later(this, this.rerender, rerenderDelay));
  },

  willDestroyElement: function() {
    if( this.delayedRerender ) {
      Em.run.cancel(this.get('delayedRerender'));
    }
  }
});
