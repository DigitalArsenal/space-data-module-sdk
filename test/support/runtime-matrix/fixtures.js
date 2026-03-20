export const PURE_WASI_FIXTURE_SOURCE = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int main(int argc, char **argv) {
  char stdin_buffer[256];
  size_t read_count = fread(stdin_buffer, 1, sizeof(stdin_buffer) - 1, stdin);
  stdin_buffer[read_count] = '\\0';

  const char *env_value = getenv("HARNESS_ENV");
  const char *file_path = getenv("HARNESS_FILE");
  char file_buffer[256];
  file_buffer[0] = '\\0';

  if (file_path && file_path[0] != '\\0') {
    FILE *file = fopen(file_path, "rb");
    if (file) {
      size_t file_count = fread(file_buffer, 1, sizeof(file_buffer) - 1, file);
      file_buffer[file_count] = '\\0';
      fclose(file);
    }
  }

  time_t now = time(NULL);

  fprintf(stdout, "stdin=%s\\n", stdin_buffer);
  fprintf(stdout, "env=%s\\n", env_value ? env_value : "");
  fprintf(stdout, "arg=%s\\n", argc > 1 ? argv[1] : "");
  fprintf(stdout, "file=%s\\n", file_buffer);
  fprintf(stdout, "time_ok=%d\\n", now > 0 ? 1 : 0);
  fprintf(stderr, "stderr=%s\\n", env_value ? env_value : "");
  return 0;
}
`;

export const PLUGIN_RUNTIME_FIXTURE_SOURCE = `
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "space_data_module_invoke.h"

static void push_text(const char *text) {
  plugin_push_output(
    "out",
    NULL,
    NULL,
    (const uint8_t *)text,
    (uint32_t)strlen(text)
  );
}

int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "echo requires a frame");
    return 3;
  }
  plugin_push_output_typed(
    "out",
    frame->schema_name,
    frame->file_identifier,
    frame->wire_format,
    frame->root_type_name,
    frame->fixed_string_length,
    frame->byte_length,
    frame->required_alignment,
    frame->payload,
    frame->payload_length
  );
  return 0;
}

int env_file_probe(void) {
  const char *env_value = getenv("HARNESS_ENV");
  const char *file_path = getenv("HARNESS_FILE");
  char file_buffer[256];
  file_buffer[0] = '\\0';

  if (file_path && file_path[0] != '\\0') {
    FILE *file = fopen(file_path, "rb");
    if (file) {
      size_t file_count = fread(file_buffer, 1, sizeof(file_buffer) - 1, file);
      file_buffer[file_count] = '\\0';
      fclose(file);
    }
  }

  fprintf(stderr, "stderr:env_file_probe:%s\\n", env_value ? env_value : "");

  char response[512];
  snprintf(
    response,
    sizeof(response),
    "env=%s;file=%s",
    env_value ? env_value : "",
    file_buffer
  );
  push_text(response);
  return 0;
}

int stderr_probe(void) {
  fprintf(stderr, "stderr:explicit\\n");
  push_text("stderr-ok");
  return 0;
}
`;

export function createRuntimeFixtureManifest() {
  const anyType = [{ acceptsAnyFlatbuffer: true }];
  const alignedType = [{
    schemaName: "RuntimeMatrix.fbs",
    fileIdentifier: "RTMX",
    wireFormat: "aligned-binary",
    rootTypeName: "AlignedEcho",
    byteLength: 16,
    requiredAlignment: 8,
  }];
  const optionalAnyInputPort = {
    portId: "in",
    acceptedTypeSets: [{ setId: "any-in", allowedTypes: anyType }],
    minStreams: 0,
    maxStreams: 1,
    required: false,
  };
  return {
    pluginId: "com.digitalarsenal.examples.runtime-matrix",
    name: "Runtime Matrix Fixture",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct", "command"],
    methods: [
      {
        methodId: "echo",
        displayName: "Echo",
        inputPorts: [
          {
            portId: "in",
            acceptedTypeSets: [{ setId: "aligned-in", allowedTypes: alignedType }],
            minStreams: 1,
            maxStreams: 1,
            required: true,
          },
        ],
        outputPorts: [
          {
            portId: "out",
            acceptedTypeSets: [{ setId: "aligned-out", allowedTypes: alignedType }],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
      {
        methodId: "env_file_probe",
        displayName: "Env File Probe",
        inputPorts: [optionalAnyInputPort],
        outputPorts: [
          {
            portId: "out",
            acceptedTypeSets: [{ setId: "any-out", allowedTypes: anyType }],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
      {
        methodId: "stderr_probe",
        displayName: "Stderr Probe",
        inputPorts: [optionalAnyInputPort],
        outputPorts: [
          {
            portId: "out",
            acceptedTypeSets: [{ setId: "any-out", allowedTypes: anyType }],
            minStreams: 0,
            maxStreams: 1,
            required: false,
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}
