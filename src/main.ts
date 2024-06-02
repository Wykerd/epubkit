import './style.css'

import { OCFZip } from './lib/ocf'
import { BlobReader } from '@zip.js/zip.js'
import { SpineItemRendition, SpineRendition } from './lib/rendition';

async function main() {
  const zipReader = new BlobReader(await fetch('/alice.epub').then(res => res.blob()));

  const ocf = new OCFZip(zipReader);

  await ocf.load();

  const opf = await ocf.getPackageDocument();

  // @ts-ignore
  window.opf = opf;

  console.log(opf);

  // const resource = await opf.getResource("OEBPS/part0004.xhtml")

  // console.log(resource);

  // const rendition = new SpineItemRendition(resource);

  const outerContainer = document.createElement('div');
  outerContainer.style.padding = '40px';
  outerContainer.style.border = '1px solid red';
  outerContainer.style.margin = '10px';
  outerContainer.style.width = 'max-content';
  
  const container = document.createElement('div');
  container.style.height = 'calc(100vh - 160px - 40px - 2px)';
  container.style.overflow = 'hidden';
  container.style.width = '1000px';

  outerContainer.appendChild(container);
  document.body.appendChild(outerContainer);

  // rendition.attachTo(container);

  // // @ts-ignore
  // window.rendition = rendition;

  // await rendition.load();

  const rendition = new SpineRendition(opf);

  await rendition.renderTo(container);
}

main();