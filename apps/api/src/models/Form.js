import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * One field on a form.
 *
 * `name` is what the *endpoint* sees — `firstName`, `email`, `first_name`,
 * `emailAddress`. It is deliberately separate from the label, because the
 * automation platform's contract is not negotiable and the wording on the page
 * is. The site's original forms use four different naming conventions between
 * them (`firstName` in the whitepaper form, `first_name` in the booking one,
 * `emailAddress` in the Eloqua one), so a builder that derived the wire name
 * from the label could not express what is already in production.
 *
 * The labels are per-locale maps rather than translation-catalogue keys, which
 * is the choice the navigation editor already made and for the same reason: a
 * form is a self-contained thing somebody builds in one sitting, and sending
 * them to another screen to name a field would make it a two-screen job.
 */
const FormFieldSchema = new Schema({
  key: { type: String, required: true },
  name: { type: String, required: true },
  label: { type: Map, of: String, default: {} },
  placeholder: { type: Map, of: String, default: {} },
  hint: { type: Map, of: String, default: {} },
  type: {
    type: String,
    enum: ['text', 'email', 'tel', 'textarea', 'select', 'checkbox', 'number', 'url', 'date', 'hidden'],
    default: 'text',
  },
  /**
   * Choices for a select, as value/label pairs.
   *
   * The value is what gets posted and the label is what a visitor reads, which
   * has to be two things: a translated form that posted its visible text would
   * send "Grande entreprise" to a workflow expecting "enterprise", and the
   * German version would send a third string again.
   */
  options: {
    type: [{
      _id: false,
      value: { type: String, default: '' },
      label: { type: Map, of: String, default: {} },
    }],
    default: [],
  },
  required: { type: Boolean, default: false },
  /**
   * A field the visitor must complete but whose value is not forwarded.
   *
   * A consent checkbox is the case: the tick is a legal precondition, not data
   * the automation wants, and several workflows reject an unexpected key.
   */
  submit: { type: Boolean, default: true },
  /** `full` spans both columns; `auto` takes one. */
  width: { type: String, enum: ['auto', 'full'], default: 'auto' },
  /**
   * The browser's autofill hint — `given-name`, `email`, `organization`.
   * Worth a field of its own: a form that autofills is completed measurably
   * more often, and this is not something an editor will guess.
   */
  autocomplete: { type: String, default: '' },
  /** For a hidden field: the fixed value sent with every submission. */
  value: { type: String, default: '' },
  rows: { type: Number, default: 4 },
  order: { type: Number, default: 0 },
}, { _id: false });

/**
 * A form, defined once and used anywhere.
 *
 * The first version of this lived inside a page block, which meant the demo
 * form on four product pages was four separate forms that drifted apart, and
 * changing the consent wording was four edits plus a fifth page nobody
 * remembered. A form is a thing, not a property of a block — so blocks and
 * article sections reference one by key and carry only presentation.
 *
 * `target` is where submissions go, as one string:
 *
 *   lead:demo          stored under Leads, filed as a demo request
 *   hook:booking       stored *and* forwarded to that integration, server-side
 *
 * Stored either way. That is what makes a misconfigured automation cost a retry
 * rather than a fortnight of lost enquiries.
 *
 * What this deliberately is not: the booking calendar, the reschedule wizard and
 * the token-confirmation pages are not field lists — they are multi-step flows
 * with a slot picker and a lookup-then-confirm handshake. Pretending a field
 * list could express them would produce a builder that half-works on the four
 * hardest pages on the site. Those stay as authored pages.
 */
const FormSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  name: { type: String, required: true },
  note: { type: String, default: '' },

  target: { type: String, default: 'lead:contact' },

  fields: { type: [FormFieldSchema], default: [] },

  /** Consent and privacy wording under the fields. HTML, so it can carry a link. */
  consent: { type: Map, of: String, default: {} },
  submitLabel: { type: Map, of: String, default: {} },
  /** Shown on the button while the request is in flight. */
  sendingLabel: { type: Map, of: String, default: {} },

  success: {
    title: { type: Map, of: String, default: {} },
    /**
     * The thank-you copy. `{fieldName}` interpolates what the visitor submitted,
     * and any response key the integration allows through — so "we have sent it
     * to {email}" and "your reference is {reference}" work without a developer.
     */
    message: { type: Map, of: String, default: {} },
    /**
     * Where to send them instead of showing the message. A page reference
     * (`page:merci`) rather than a path, so it survives a rename and resolves
     * per language like every other link in the CMS.
     */
    redirect: { type: String, default: '' },
  },

  layout: {
    columns: { type: Number, enum: [1, 2], default: 2 },
    align: { type: String, enum: ['left', 'center'], default: 'left' },
  },

  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true, minimize: false });

export const Form = mongoose.model('Form', FormSchema);
