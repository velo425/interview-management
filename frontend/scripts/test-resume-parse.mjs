import { extractMemberFields } from '../server/resumeParse.js';

const samples = [
  {
    label: 'Johann',
    file: 'JOHANN_CLOUIE_HALAGHAY.pdf',
    text: [
      'JOHANN CLOUIE HALAGHAY',
      'Senior AI & Full-Stack Engineer',
      'leomarksio386@gmail.com | +63 949 649 1729 | Batangas, Philippines | johannclouie.vercel.app',
      'linkedin.com/in/johann-clouie-halaghay | github.com/velo-coder',
      '',
      'EXPERIENCE',
      'Built Testing, CI pipelines for production.',
    ].join('\n'),
  },
  {
    label: 'Brandon',
    file: 'brandon.pdf',
    text: [
      'BRANDON RIPLEY',
      'SENIOR SOFTWARE ENGINEER',
      'Tampa, FL | +12027034071 | evanbrooks202@gmail.com',
      'LinkedIn: https://www.linkedin.com/in/brandon-ripley-dev/',
      'github: https://github.com/sunzaim105-sudo',
      '',
      'SKILLS',
      'Testing, CI, Docker',
    ].join('\n'),
  },
  {
    label: 'Brian',
    file: 'brian.pdf',
    text: [
      'Brian Bruce Nguyen',
      'Leander, TX | (929) 248-4332 | jeannie16nguyen@gmail.com',
      '',
      'Summary',
      'Software engineer with experience.',
    ].join('\n'),
  },
];

let failed = 0;
for (const sample of samples) {
  const result = extractMemberFields(sample.text, sample.file);
  console.log(sample.label, result);
  const missing = [];
  if (!result.name) missing.push('name');
  if (!result.email) missing.push('email');
  if (!result.phone_number) missing.push('phone');
  if (!result.location) missing.push('location');
  if (sample.label !== 'Brian' && !result.professional_title) {
    missing.push('title');
  }
  if (missing.length) {
    failed += 1;
    console.error(`  FAIL missing: ${missing.join(', ')}`);
  }
}

if (failed) process.exit(1);
console.log('All sample headers parsed.');
