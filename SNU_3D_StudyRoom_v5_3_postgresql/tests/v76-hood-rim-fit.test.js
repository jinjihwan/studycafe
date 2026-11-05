import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const source = html.slice(html.indexOf('function animalModel(species,hood){'), html.indexOf('\nclass Character{'));
assert.ok(source.startsWith('function animalModel('), 'animal model function must exist');

function buildModel(species) {
  class Group { constructor() { this.children = []; this.position = {set() {}}; this.rotation = {x:0,y:0,z:0}; } add(obj) { this.children.push(obj); } }
  class Material { constructor(options) { this.options = options; } }
  const meshes = [];
  const context = {
    THREE: { Group, MeshStandardMaterial: Material, Object3D: class { constructor() { this.position = { set() {} }; } } },
    mesh(parent, geo, material, pos, scale, rot) {
      const item = { geo, material, pos: [...pos], scale: [...scale], rot, parent };
      parent.add(item);
      meshes.push(item);
      return item;
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const model = context.animalModel(species, '#f39bc4');
  return {model, meshes};
}

test('hood rim follows the body with a near-flush local depth for all four animals', () => {
  for (const species of ['rabbit', 'bear', 'cat', 'dog']) {
    const {model, meshes} = buildModel(species);
    const rim = meshes.filter(part => part.geo === 'torus');
    assert.equal(rim.length, 1, `${species}: one hood rim`);
    assert.equal(rim[0].parent, model.body, `${species}: rim belongs to the animated body`);
    assert.equal(rim[0].pos[0], 0);
    assert.equal(rim[0].pos[1], 1.79);
    assert.ok(Math.abs(rim[0].pos[2] - .20) < .001, `${species}: rim sits against hood shell`);
    assert.ok(rim[0].pos[2] < .26, 'rim must not float at the old z=.47');
    // In the original geometry the shell is an ellipsoid centered at z=-.085,
    // radii .55, .57, .49. Its front surface at the seam has z≈.19-.20.
    for (let i=0; i<72; i++) {
      const angle = i * Math.PI*2 / 72;
      const x = rim[0].scale[0] * Math.cos(angle);
      const y = rim[0].scale[1] * Math.sin(angle);
      const contourZ = -.085 + .49 * Math.sqrt(1 - (x/.55)**2 - (y/.57)**2);
      assert.ok(Math.abs(rim[0].pos[2]-contourZ) < .025, `${species}: rim contour follows shell`);
    }
  }
});

test('face, drawstrings, ears and avatar movement API remain unchanged', () => {
  assert.match(source, /mesh\(body,'sphere',fur,\[0,1\.8,\.281\],\[\.419,\.402,\.25\]\)/);
  assert.match(source, /for\(const x of \[-\.13,\.13\]\)mesh\(body,'cylinder',white/);
  assert.match(source, /const anchor=new THREE\.Object3D\(\)/);
  assert.match(html, /animateLocomotion\(dt,elapsed\)/);
  assert.match(html, /setAvatarCameraPivot\(targetFollow,player\.root\)/);
});
