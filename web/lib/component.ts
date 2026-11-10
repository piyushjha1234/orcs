// Base for the page components. Each one is a custom element that renders into its own light DOM.
// Setting .data re-renders; listeners live on the element itself, so they survive re-renders.
import type { Raw } from './dom.ts';

export abstract class Component<T> extends HTMLElement {
  #data: T | undefined;

  set data(value: T) {
    this.#data = value;
    this.render(value);
  }

  get data(): T | undefined {
    return this.#data;
  }

  protected abstract render(value: T): void;

  protected paint(content: Raw): void {
    this.innerHTML = content.value;
  }
}
