// Branding and global settings. Change these to rebrand the simulator.
window.APP_CONFIG = {
  name: 'ExamSim',
  tagline: 'Computer-based exam simulator',
  // Shown on the agreement step before every exam.
  agreement: [
    'This practice exam is for personal study only.',
    'Work independently and do not use outside help, notes, or other websites during a timed simulation.',
    'Do not copy, record, or share the questions in this exam.',
    'Results are a practice estimate and do not predict an official exam outcome.'
  ],
  // Domain performance bands (percent correct) used on the score report.
  ratingBands: [
    { min: 80, label: 'Above Target', cls: 'above' },
    { min: 65, label: 'Target', cls: 'target' },
    { min: 50, label: 'Below Target', cls: 'below' },
    { min: 0,  label: 'Needs Improvement', cls: 'needs' }
  ],
  // How many past attempts to keep in this browser.
  historyLimit: 25
};
