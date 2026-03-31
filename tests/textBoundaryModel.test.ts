import { describe, expect, it } from 'vitest';

import { refineLexicalTextBoundaries } from '../src/parser/textBoundaryModel.js';
import type { PDFTextItem } from '../src/types.js';

function buildItem(
  text: string,
  glyphSpans: NonNullable<PDFTextItem['glyphSpans']>,
  minY: number
): PDFTextItem {
  const width = glyphSpans.reduce((sum, span) => sum + span.advance, 0);
  return {
    text,
    font: 'Times New Roman',
    fontSize: 10,
    bounds: {
      minX: 100,
      minY,
      maxX: 100 + width,
      maxY: minY + 10
    },
    baselineStart: { x: 100, y: minY + 2 },
    baselineEnd: { x: 100 + width, y: minY + 2 },
    glyphSpans
  };
}

function wordGlyphs(text: string): NonNullable<PDFTextItem['glyphSpans']> {
  return Array.from(text).map((char) => ({
    text: char,
    advance: 5
  }));
}

describe('text boundary model', () => {
  it('keeps title-case author names intact even when email local-parts bias the lexicon', () => {
    const items: PDFTextItem[] = [
      buildItem('Kai Chen', [...wordGlyphs('Kai'), { text: ' ', advance: 2.5, synthetic: true }, ...wordGlyphs('Chen')], 600),
      buildItem('Tomas Mikolov', [...wordGlyphs('Tomas'), { text: ' ', advance: 2.5, synthetic: true }, ...wordGlyphs('Mikolov')], 580),
      buildItem(
        'T. , Goldstein, A., ',
        Array.from('T. , Goldstein, A., ').map((char) => ({
          text: char,
          advance: char === ' ' ? 0.25 : 5
        })),
        570
      ),
      buildItem('kaichen@google.com', wordGlyphs('kaichen@google.com'), 560),
      buildItem('tmikolov@google.com', wordGlyphs('tmikolov@google.com'), 540)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('Kai Chen');
    expect(refined[1]?.text).toBe('Tomas Mikolov');
    expect(refined[2]?.text).toBe('T. , Goldstein, A., ');
  });

  it('preserves normal geometry-backed spaces from the text smoother', () => {
    const items: PDFTextItem[] = [
      buildItem(
        'Doing so requires a stack of',
        [
          ...wordGlyphs('Doing'),
          { text: ' ', advance: 2.4, synthetic: true },
          ...wordGlyphs('so'),
          { text: ' ', advance: 2.5, synthetic: true },
          ...wordGlyphs('requires'),
          { text: ' ', advance: 2.3, synthetic: true },
          ...wordGlyphs('a'),
          { text: ' ', advance: 2.2, synthetic: true },
          ...wordGlyphs('stack'),
          { text: ' ', advance: 2.4, synthetic: true },
          ...wordGlyphs('of')
        ],
        520
      ),
      buildItem(
        'dilated convolutions increasing the length',
        [
          ...wordGlyphs('dilated'),
          { text: ' ', advance: 2.5, synthetic: true },
          ...wordGlyphs('convolutions'),
          { text: ' ', advance: 2.5, synthetic: true },
          ...wordGlyphs('increasing'),
          { text: ' ', advance: 2.5, synthetic: true },
          ...wordGlyphs('the'),
          { text: ' ', advance: 2.5, synthetic: true },
          ...wordGlyphs('length')
        ],
        500
      )
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('Doing so requires a stack of');
    expect(refined[1]?.text).toBe('dilated convolutions increasing the length');
  });

  it('preserves URL-like text without inserting domain punctuation spaces', () => {
    const items: PDFTextItem[] = [
      buildItem(
        'https://github.com/',
        wordGlyphs('https://github.com/'),
        480
      ),
      buildItem(
        'tensorflow/tensor2tensor',
        wordGlyphs('tensorflow/tensor2tensor'),
        460
      ),
      buildItem(
        'Copyright Cambridge University Press 2003. On-screen viewing permitted. Printing not permitted. http://www.cambridge.org/0521642981',
        Array.from('Copyright Cambridge University Press 2003. On-screen viewing permitted. Printing not permitted. http://www.cambridge.org/0521642981').map((char) => ({
          text: char,
          advance: char === ' ' ? 4 : 4
        })),
        440
      )
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('https://github.com/');
    expect(refined[1]?.text).toBe('tensorflow/tensor2tensor');
    expect(refined[2]?.text).toContain('On-screen viewing permitted.');
    expect(refined[2]?.text).toContain('http://www.cambridge.org/0521642981');
    expect(refined[2]?.text).not.toContain('www. cambridge. org');
  });

  it('preserves email addresses without inserting spaces around domain punctuation', () => {
    const items: PDFTextItem[] = [
      buildItem('avaswani@google.com', wordGlyphs('avaswani@google.com'), 420),
      buildItem('aidan@cs.toronto.edu', wordGlyphs('aidan@cs.toronto.edu'), 400),
      buildItem('lukaszkaiser@google.com', wordGlyphs('lukaszkaiser@google.com'), 380)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('avaswani@google.com');
    expect(refined[1]?.text).toBe('aidan@cs.toronto.edu');
    expect(refined[2]?.text).toBe('lukaszkaiser@google.com');
  });

  it('does not collapse ordinary geometry-backed spaces in front-matter fragments', () => {
    const items: PDFTextItem[] = [
      buildItem(
        'ly Inspired Engineeri',
        [
          ...wordGlyphs('ly'),
          { text: ' ', advance: 0.25 },
          ...wordGlyphs('Inspired'),
          { text: ' ', advance: 0.25 },
          ...wordGlyphs('Engineeri')
        ],
        360
      ),
      buildItem(
        'onding author: ',
        [
          ...wordGlyphs('onding'),
          { text: ' ', advance: 0.25 },
          ...wordGlyphs('author: ')
        ],
        340
      )
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('ly Inspired Engineeri');
    expect(refined[1]?.text).toBe('onding author: ');
  });

  it('does not let repeated merged tokens self-validate through frequency counts', () => {
    const items: PDFTextItem[] = [
      buildItem('The conditionalentropy of', wordGlyphs('The conditionalentropy of'), 420),
      buildItem('This section gives definitions and exercises to do withentropy, carrying on', wordGlyphs('This section gives definitions and exercises to do withentropy, carrying on'), 400),
      buildItem('so communication overnoisy channels', wordGlyphs('so communication overnoisy channels'), 380),
      buildItem('over the channel { so communication overnoisy channels (the topic of chapters', wordGlyphs('over the channel { so communication overnoisy channels (the topic of chapters'), 360)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toContain('conditional entropy');
    expect(refined[1]?.text).toContain('with entropy');
    expect(refined[2]?.text).toContain('over noisy channels');
    expect(refined[3]?.text).toContain('topic of chapters');
    expect(refined[3]?.text).not.toContain('to picofchapters');
  });

  it('keeps explicit front-matter repairs enabled on the conservative path', () => {
    const items: PDFTextItem[] = [
      buildItem(
        "First, Iteach in Cambridge: 'Information theory, pattern recognition, and neural networks'.",
        wordGlyphs("First, Iteach in Cambridge: 'Information theory, pattern recognition, and neural networks'."),
        340
      )
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toContain('I teach in Cambridge');
    expect(refined[0]?.text).not.toContain('Iteach');
  });

  it('splits merged title-case words and attached connector suffixes without breaking short surnames', () => {
    const items: PDFTextItem[] = [
      buildItem('HybridEmbodiments', wordGlyphs('HybridEmbodiments'), 320),
      buildItem('IngressingMinds', wordGlyphs('IngressingMinds'), 300),
      buildItem('PatternsBeyond', wordGlyphs('PatternsBeyond'), 280),
      buildItem('Geneticsand', wordGlyphs('Geneticsand'), 260),
      buildItem('McKay', wordGlyphs('McKay'), 240)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('Hybrid Embodiments');
    expect(refined[1]?.text).toBe('Ingressing Minds');
    expect(refined[2]?.text).toBe('Patterns Beyond');
    expect(refined[3]?.text).toBe('Genetics and');
    expect(refined[4]?.text).toBe('McKay');
  });

  it('repairs sentence punctuation without breaking compact domains or abbreviations', () => {
    const items: PDFTextItem[] = [
      buildItem(
        'attention mechanism.We propose a new simple network architecture',
        Array.from('attention mechanism.We propose a new simple network architecture').map((char) => ({
          text: char,
          advance: char === ' ' ? 2.5 : 5
        })),
        220
      ),
      buildItem(
        'entirely.Experiments on two machine translation tasks',
        Array.from('entirely.Experiments on two machine translation tasks').map((char) => ({
          text: char,
          advance: char === ' ' ? 2.5 : 5
        })),
        200
      ),
      buildItem('www.cambridge.org', Array.from('www.cambridge.org').map((char) => ({ text: char, advance: 5 })), 180),
      buildItem('U.S.A', Array.from('U.S.A').map((char) => ({ text: char, advance: 5 })), 160)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('attention mechanism. We propose a new simple network architecture');
    expect(refined[1]?.text).toBe('entirely. Experiments on two machine translation tasks');
    expect(refined[2]?.text).toBe('www.cambridge.org');
    expect(refined[3]?.text).toBe('U.S.A');
  });

  it('repairs reduced-paper front-matter joins without re-breaking merged emails', () => {
    const items: PDFTextItem[] = [
      buildItem('WyssInstituteforBiologicallyInspiredEngineering', wordGlyphs('WyssInstituteforBiologicallyInspiredEngineering'), 140),
      buildItem('Correspondingauthor', wordGlyphs('Correspondingauthor'), 120),
      buildItem('Runningtitle', wordGlyphs('Runningtitle'), 100),
      buildItem('Ingressingcognitivepatterns', wordGlyphs('Ingressingcognitivepatterns'), 80),
      buildItem('basalcognition', wordGlyphs('basalcognition'), 60),
      buildItem('diverseintelligence', wordGlyphs('diverseintelligence'), 40),
      buildItem(
        'MA02155',
        Array.from('MA02155').map((char) => ({
          text: char,
          advance: 5
        })),
        20
      ),
      buildItem('*Correspondingauthor: michael.levin@tufts.edu', wordGlyphs('*Correspondingauthor: michael.levin@tufts.edu'), 0)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('Wyss Institute for Biologically Inspired Engineering');
    expect(refined[1]?.text).toBe('Corresponding author');
    expect(refined[2]?.text).toBe('Running title');
    expect(refined[3]?.text).toBe('Ingressing cognitive patterns');
    expect(refined[4]?.text).toBe('basal cognition');
    expect(refined[5]?.text).toBe('diverse intelligence');
    expect(refined[6]?.text).toBe('MA 02155');
    expect(refined[7]?.text).toBe('*Corresponding author: michael.levin@tufts.edu');
  });

  it('merges capitalized prefix splits and weak fragment runs without collapsing normal prose spacing', () => {
    const items: PDFTextItem[] = [
      buildItem('A ffiliations', wordGlyphs('A ffiliations'), 180),
      buildItem('I ngressing', wordGlyphs('I ngressing'), 160),
      buildItem('expla in', wordGlyphs('expla in'), 150),
      buildItem('Regulariz at i on', wordGlyphs('Regulariz at i on'), 140),
      buildItem('convolut i on', wordGlyphs('convolut i on'), 120),
      buildItem('Experiments on two machine translation tasks', wordGlyphs('Experiments on two machine translation tasks'), 100)
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('Affiliations');
    expect(refined[1]?.text).toBe('Ingressing');
    expect(refined[2]?.text).toBe('explain');
    expect(refined[3]?.text).toBe('Regularization');
    expect(refined[4]?.text).toBe('convolution');
    expect(refined[5]?.text).toBe('Experiments on two machine translation tasks');
  });

  it('repairs reduced-paper body-text joins across first-person verbs and long Platonic-space chains', () => {
    const items: PDFTextItem[] = [
      buildItem('Ipresent', wordGlyphs('Ipresent'), 140),
      buildItem('Ihypothesize', wordGlyphs('Ihypothesize'), 120),
      buildItem('Ihavesaid', wordGlyphs('Ihavesaid'), 100),
      buildItem('Ithinktheorganicistpositionisright', wordGlyphs('Ithinktheorganicistpositionisright'), 80),
      buildItem('Incontrast', wordGlyphs('Incontrast'), 60),
      buildItem('Thelatent', wordGlyphs('Thelatent'), 40),
      buildItem('physicalworld', wordGlyphs('physicalworld'), 20),
      buildItem('richlatent', wordGlyphs('richlatent'), 0),
      buildItem('intothePlatonicspaceallowing', wordGlyphs('intothePlatonicspaceallowing'), -20),
      buildItem(
        'fishinginregionsofPlatonicspacewehaveneverexploredbefore',
        wordGlyphs('fishinginregionsofPlatonicspacewehaveneverexploredbefore'),
        -40
      ),
      buildItem(
        'interfacesandthestructurestowhichtheypointinthePlatonicspace',
        wordGlyphs('interfacesandthestructurestowhichtheypointinthePlatonicspace'),
        -60
      )
    ];

    const refined = refineLexicalTextBoundaries(items);

    expect(refined[0]?.text).toBe('I present');
    expect(refined[1]?.text).toBe('I hypothesize');
    expect(refined[2]?.text).toBe('I have said');
    expect(refined[3]?.text).toBe('I think the organicist position is right');
    expect(refined[4]?.text).toBe('In contrast');
    expect(refined[5]?.text).toBe('The latent');
    expect(refined[6]?.text).toBe('physical world');
    expect(refined[7]?.text).toBe('rich latent');
    expect(refined[8]?.text).toBe('into the Platonic space allowing');
    expect(refined[9]?.text).toBe('fishing in regions of Platonic space we have never explored before');
    expect(refined[10]?.text).toBe('interfaces and the structures to which they point in the Platonic space');
  });
});
