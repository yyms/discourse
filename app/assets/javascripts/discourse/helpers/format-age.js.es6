import { autoUpdatingRelativeAge } from 'discourse/lib/formatter';
import registerUnbound from 'discourse/helpers/register-unbound';

registerUnbound('format-age', function(dt) {
  dt = new Date(dt);
  return new Handlebars.SafeString(autoUpdatingRelativeAge(dt));
});
