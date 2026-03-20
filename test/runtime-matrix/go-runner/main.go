package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
	"github.com/tetratelabs/wazero/sys"
)

type Preopen struct {
	HostPath  string `json:"hostPath"`
	GuestPath string `json:"guestPath"`
}

type Spec struct {
	WasmPath    string            `json:"wasmPath"`
	StdinBase64 string            `json:"stdinBase64"`
	Args        []string          `json:"args"`
	Env         map[string]string `json:"env"`
	Preopens    []Preopen         `json:"preopens"`
}

type Result struct {
	OK           bool   `json:"ok"`
	ExitCode     int    `json:"exitCode"`
	StdoutBase64 string `json:"stdoutBase64"`
	StderrBase64 string `json:"stderrBase64"`
}

func main() {
	if len(os.Args) < 2 {
		panic("expected spec path")
	}

	var spec Spec
	bytesIn, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	if err := json.Unmarshal(bytesIn, &spec); err != nil {
		panic(err)
	}

	stdinBytes, err := base64.StdEncoding.DecodeString(spec.StdinBase64)
	if err != nil {
		panic(err)
	}

	ctx := context.Background()
	r := wazero.NewRuntime(ctx)
	defer r.Close(ctx)

	wasi_snapshot_preview1.MustInstantiate(ctx, r)

	compiled, err := r.CompileModule(ctx, mustRead(spec.WasmPath))
	if err != nil {
		panic(err)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	config := wazero.NewModuleConfig().
		WithArgs(spec.Args...).
		WithStdin(bytes.NewReader(stdinBytes)).
		WithStdout(&stdout).
		WithStderr(&stderr)

	for key, value := range spec.Env {
		config = config.WithEnv(key, value)
	}

	fsConfig := wazero.NewFSConfig()
	for _, preopen := range spec.Preopens {
		fsConfig = fsConfig.WithDirMount(preopen.HostPath, preopen.GuestPath)
	}
	config = config.WithFSConfig(fsConfig)

	exitCode := 0
	_, err = r.InstantiateModule(ctx, compiled, config)
	if err != nil {
		if exitErr, ok := err.(*sys.ExitError); ok {
			exitCode = int(exitErr.ExitCode())
		} else {
			panic(err)
		}
	}

	result := Result{
		OK:           true,
		ExitCode:     exitCode,
		StdoutBase64: base64.StdEncoding.EncodeToString(stdout.Bytes()),
		StderrBase64: base64.StdEncoding.EncodeToString(stderr.Bytes()),
	}

	encoded, err := json.Marshal(result)
	if err != nil {
		panic(err)
	}
	fmt.Print(string(encoded))
}

func mustRead(path string) []byte {
	bytes, err := os.ReadFile(path)
	if err != nil {
		panic(err)
	}
	return bytes
}
