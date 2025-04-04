type ClassProperties<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K];
};

export class Struct {
  /**
   * Creates an instance of a class with the provided property values.
   *
   * Example usage:
   *
   * ```typescript
   * class User extends Data {
   *   declare name: string;
   *   declare age?: number;
   *
   *   static create<T extends User>(
   *     this: new () => T,
   *     values: ClassProperties<T>
   *   ) {
   *     let instance = super.create.call(this, values) as User;
   *     instance.age = instance.age ?? 9000;
   *     return instance as unknown as T;
   *   }
   *
   *   display() {
   *     console.log(this.name, this.age);
   *   }
   * }
   *
   * let user = User.create({
   *   name: "Goku",
   * });
   *
   * user.display(); // Output: Goku 9000
   * ```
   */
  static create<T extends Struct>(
    this: new () => T,
    values: ClassProperties<T>,
  ): T {
    let instance = new this();
    Object.assign(instance, values);
    return instance;
  }

  constructor() {
    if (new.target === Struct) {
      throw new Error("Data is abstract and cannot be instantiated directly");
    }
  }
}
