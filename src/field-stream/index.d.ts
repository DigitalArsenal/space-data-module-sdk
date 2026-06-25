export function encodeUnsignedFieldStreamPolicyForProviderSignature(
  policy: unknown,
): Uint8Array;

export function verifyFieldStreamPolicyProviderSignature(
  policy: unknown,
  options: {
    providerPublicKey: Uint8Array | ArrayBuffer | ArrayBufferView;
    verify(
      publicKey: Uint8Array,
      payload: Uint8Array,
      signature: Uint8Array,
    ): boolean | Promise<boolean>;
  },
): Promise<unknown>;

export function encodeUnsignedFieldStreamMessageForProviderSignature(
  message: unknown,
): Uint8Array;

export function verifyFieldStreamMessageProviderSignature(
  message: unknown,
  options: {
    providerPublicKey: Uint8Array | ArrayBuffer | ArrayBufferView;
    verify(
      publicKey: Uint8Array,
      payload: Uint8Array,
      signature: Uint8Array,
    ): boolean | Promise<boolean>;
  },
): Promise<unknown>;
