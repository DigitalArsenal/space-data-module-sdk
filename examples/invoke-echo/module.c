#include <stdint.h>

#include "space_data_module_invoke.h"

int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }

  plugin_push_output(
    "echo",
    frame->schema_name,
    frame->file_identifier,
    frame->payload,
    frame->payload_length
  );
  return 0;
}
