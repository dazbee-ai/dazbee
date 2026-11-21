import { describe, expect, it } from 'vitest'

import { googleFontList, parseMetadata, scriptCodes, subsetScripts } from './google-metadata.ts'

/** A few lines of Unicode's PropertyValueAliases.txt. */
const ALIASES = `# PropertyValueAliases.txt
sc ; Arab                             ; Arabic
sc ; Cyrl                             ; Cyrillic
sc ; Latn                             ; Latin
sc ; Ital                             ; Old_Italic
gc ; L                                ; Letter
`

/** A family's METADATA.pb, in protobuf's text format. */
function metadata(name: string, license: string, fonts: string[], extra = ''): string {
  const files = fonts
    .map((font) => {
      const [filename, style = 'normal', weight = '400'] = font.split(' ')
      return `fonts {\n  name: "${name}"\n  style: "${style}"\n  weight: ${weight}\n  filename: "${filename}"\n}`
    })
    .join('\n')
  return `name: "${name}"\nlicense: "${license}"\ncategory: "SANS_SERIF"\n${files}\nsubsets: "latin"\nsubsets: "menu"\n${extra}`
}

/** A tree holding every file named, each of 100 bytes. */
const treeOf = (...paths: string[]) => paths.map((path, i) => ({ path, sha: String(i).padStart(40, 'a'), size: 100 }))

const listed = (family: string, popularity: number, defaultSort = popularity, category = 'Sans Serif') => ({
  family,
  category,
  popularity,
  defaultSort,
})

describe('parseMetadata', () => {
  it('reads the family, licence, files, subsets, axes and primary script', () => {
    const text = `# The family's metadata.
name: "Vary Sans"
designer: "Someone"
license: "OFL"
fonts {
  name: "Vary Sans"
  style: "normal"
  weight: 400
  filename: "VarySans[wght].ttf"
  copyright: "Copyright 2020 "
    "The Vary Sans Authors"
}
subsets: "arabic"
subsets: "latin"
axes {
  tag: "wght"
  min_value: 100.0
  max_value: 900.0
}
primary_script: "Arab"
source {
  files {
    source_file: "a.ttf"
  }
}
`
    expect(parseMetadata(text)).toEqual({
      name: 'Vary Sans',
      license: 'OFL',
      fonts: [{ style: 'normal', weight: 400, filename: 'VarySans[wght].ttf' }],
      subsets: ['arabic', 'latin'],
      axes: [{ tag: 'wght', min: 100, max: 900 }],
      primaryScript: 'Arab',
    })
  })

  it('reads escapes, an octal one as a byte of UTF-8', () => {
    expect(parseMetadata('name: "Caf\\303\\251 \\"Sans\\""\nlicense: "OFL"').name).toBe('Café "Sans"')
  })

  it('refuses text it cannot read', () => {
    expect(() => parseMetadata('name: "A"\nlicense: "OFL"\nfonts {')).toThrow()
    expect(() => parseMetadata('license: "OFL"')).toThrow(/names no family/)
  })
})

describe('scriptCodes', () => {
  it('names each Unicode script by its long name, in Google’s spelling', () => {
    const codes = scriptCodes(ALIASES)
    expect(codes.get('arabic')).toBe('Arab')
    expect(codes.get('old-italic')).toBe('Ital')
    expect(codes.has('letter')).toBe(false)
  })
})

describe('subsetScripts', () => {
  const codes = scriptCodes(ALIASES)

  it('turns subsets into ISO 15924 codes, each once, leaving out those that name no script', () => {
    expect(subsetScripts(['latin', 'latin-ext', 'vietnamese', 'menu', 'cyrillic-ext', 'old-italic'], codes)).toEqual([
      'Latn',
      'Cyrl',
      'Ital',
    ])
    expect(subsetScripts(['japanese', 'korean', 'chinese-hongkong', 'emoji', 'math'], codes)).toEqual([
      'Jpan',
      'Kore',
      'Hant',
      'Zsye',
      'Zmth',
    ])
  })

  it('refuses a subset it can’t name, so a new one is noticed', () => {
    expect(() => subsetScripts(['klingon'], codes)).toThrow(/klingon/)
  })
})

describe('googleFontList', () => {
  const list = (input: Partial<Parameters<typeof googleFontList>[0]>) =>
    googleFontList({ metadata: [], tree: [], listing: [], aliases: ALIASES, shipped: new Set(), ...input })

  it('keeps a listed family with its category, files, axes and scripts', () => {
    const { families, leftOut } = list({
      metadata: [
        {
          path: 'ofl/varysans',
          text: metadata(
            'Vary Sans',
            'OFL',
            ['VarySans-Italic[wght].ttf italic', 'VarySans[wght].ttf'],
            'subsets: "arabic"\naxes {\n  tag: "wght"\n  min_value: 100\n  max_value: 900\n}\nprimary_script: "Arab"',
          ),
        },
      ],
      tree: treeOf('ofl/varysans/VarySans[wght].ttf', 'ofl/varysans/VarySans-Italic[wght].ttf'),
      listing: [listed('Vary Sans', 7, 7, 'Display')],
    })
    expect(leftOut).toEqual([])
    expect(families).toEqual([
      {
        family: 'Vary Sans',
        category: 'display',
        rank: 1,
        licence: 'OFL',
        path: 'ofl/varysans',
        scripts: ['Arab', 'Latn'],
        axes: [{ tag: 'wght', min: 100, max: 900 }],
        faces: [
          { file: 'VarySans[wght].ttf', blob: treeOf('', '')[0]?.sha, bytes: 100, weight: 400, style: 'normal' },
          { file: 'VarySans-Italic[wght].ttf', blob: treeOf('', '')[1]?.sha, bytes: 100, weight: 400, style: 'italic' },
        ],
      },
    ])
  })

  it('takes the OFL, Apache 2.0 and UFL, and leaves out a family under any other licence', () => {
    const { families, leftOut } = list({
      metadata: [
        { path: 'ofl/one', text: metadata('One', 'OFL', ['One.ttf']) },
        { path: 'apache/two', text: metadata('Two', 'APACHE2', ['Two.ttf']) },
        { path: 'ufl/three', text: metadata('Three', 'UFL', ['Three.ttf']) },
        { path: 'ofl/four', text: metadata('Four', 'PROPRIETARY', ['Four.ttf']) },
      ],
      tree: treeOf('ofl/one/One.ttf', 'apache/two/Two.ttf', 'ufl/three/Three.ttf', 'ofl/four/Four.ttf'),
      listing: [listed('One', 1), listed('Two', 2), listed('Three', 3), listed('Four', 4)],
    })
    expect(families.map((f) => [f.family, f.licence])).toEqual([
      ['One', 'OFL'],
      ['Two', 'Apache-2.0'],
      ['Three', 'UFL'],
    ])
    expect(leftOut).toEqual([{ family: 'Four', reason: 'its licence is PROPRIETARY' }])
  })

  it('ranks by popularity, then Google Fonts’ own order, then name', () => {
    const names = ['Cee', 'Bee', 'Ay', 'Dee']
    const { families } = list({
      metadata: names.map((name) => ({ path: `ofl/${name.toLowerCase()}`, text: metadata(name, 'OFL', ['F.ttf']) })),
      tree: treeOf(...names.map((name) => `ofl/${name.toLowerCase()}/F.ttf`)),
      listing: [listed('Cee', 2, 1), listed('Bee', 2, 1), listed('Ay', 2, 5), listed('Dee', 1, 9)],
    })
    expect(families.map((f) => [f.family, f.rank])).toEqual([
      ['Dee', 1],
      ['Bee', 2],
      ['Cee', 3],
      ['Ay', 4],
    ])
  })

  it('leaves out what Google Fonts doesn’t serve, what it serves without metadata, what we ship and a missing file', () => {
    const { families, leftOut } = list({
      metadata: [
        { path: 'ofl/unlisted', text: metadata('Unlisted', 'OFL', ['U.ttf']) },
        { path: 'ofl/notosans', text: metadata('Noto Sans', 'OFL', ['N.ttf']) },
        { path: 'ofl/lost', text: metadata('Lost', 'OFL', ['Gone.ttf']) },
        { path: 'ofl/kept', text: metadata('Kept', 'OFL', ['K.ttf']) },
        { path: 'apache/kept', text: metadata('Kept', 'APACHE2', ['K.ttf']) },
      ],
      tree: treeOf('ofl/unlisted/U.ttf', 'ofl/notosans/N.ttf', 'ofl/kept/K.ttf', 'apache/kept/K.ttf'),
      listing: [listed('Noto Sans', 1), listed('Lost', 2), listed('Kept', 3), listed('Elsewhere', 4)],
      shipped: new Set(['Noto Sans']),
    })
    expect(families.map((f) => [f.family, f.path])).toEqual([['Kept', 'apache/kept']])
    expect(leftOut).toEqual([
      { family: 'Elsewhere', reason: 'google/fonts has no METADATA.pb for it' },
      { family: 'Kept', reason: 'another folder holds it too, so ofl/kept is left out' },
      { family: 'Lost', reason: 'google/fonts has no file Gone.ttf' },
      { family: 'Noto Sans', reason: 'we ship it' },
      { family: 'Unlisted', reason: 'Google Fonts does not serve it' },
    ])
  })

  it('keeps a variable file alone in its style, leaving out the static files of that style', () => {
    const files = [
      'M[wght].ttf',
      'M-Italic[wght].ttf italic',
      'M-Regular.ttf',
      'M-Bold.ttf normal 700',
      'M-Black.ttf normal 900',
    ]
    const { families } = list({
      metadata: [
        {
          path: 'ofl/mono',
          text: metadata('Mono', 'OFL', files, 'axes {\n  tag: "wght"\n  min_value: 300\n  max_value: 800\n}'),
        },
      ],
      tree: treeOf(...files.map((file) => `ofl/mono/${file.split(' ')[0]}`)),
      listing: [listed('Mono', 1)],
    })
    expect(families[0]?.faces.map((face) => [face.file, face.weight, face.style])).toEqual([
      ['M[wght].ttf', 400, 'normal'],
      ['M-Italic[wght].ttf', 400, 'italic'],
    ])
  })

  it('leaves out a family with two files of one weight and style', () => {
    const { leftOut } = list({
      metadata: [{ path: 'ofl/twice', text: metadata('Twice', 'OFL', ['A.ttf', 'B.ttf']) }],
      tree: treeOf('ofl/twice/A.ttf', 'ofl/twice/B.ttf'),
      listing: [listed('Twice', 1)],
    })
    expect(leftOut).toEqual([{ family: 'Twice', reason: 'two files have the weight 400 and style normal' }])
  })
})
