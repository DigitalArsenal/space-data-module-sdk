package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	flatbuffers "github.com/google/flatbuffers/go"

	manifestfb "example.com/space-data-module-sdk/examples/single-file-bundle/go/generated/orbpro/manifest"
	modulefb "example.com/space-data-module-sdk/examples/single-file-bundle/go/generated/orbpro/module"
	streamfb "example.com/space-data-module-sdk/examples/single-file-bundle/go/generated/orbpro/stream"
)

const (
	sdsCustomSectionPrefix      = "sds."
	sdsBundleSectionName        = "sds.bundle"
	defaultManifestExportSymbol = "plugin_get_manifest_flatbuffer"
	defaultManifestSizeSymbol   = "plugin_get_manifest_flatbuffer_size"
	defaultModuleFormat         = "space-data-module"
)

var (
	wasmMagic   = []byte{0x00, 0x61, 0x73, 0x6d}
	wasmVersion = []byte{0x01, 0x00, 0x00, 0x00}
	roleNames   = map[modulefb.ModuleBundleEntryRole]string{
		modulefb.ModuleBundleEntryRoleMANIFEST:      "manifest",
		modulefb.ModuleBundleEntryRoleAUTHORIZATION: "authorization",
		modulefb.ModuleBundleEntryRoleSIGNATURE:     "signature",
		modulefb.ModuleBundleEntryRoleTRANSPORT:     "transport",
		modulefb.ModuleBundleEntryRoleATTESTATION:   "attestation",
		modulefb.ModuleBundleEntryRoleAUXILIARY:     "auxiliary",
	}
	payloadEncodingNames = map[modulefb.ModulePayloadEncoding]string{
		modulefb.ModulePayloadEncodingRAW_BYTES:  "raw-bytes",
		modulefb.ModulePayloadEncodingFLATBUFFER: "flatbuffer",
		modulefb.ModulePayloadEncodingJSON_UTF8:  "json-utf8",
		modulefb.ModulePayloadEncodingCBOR:       "cbor",
	}
)

type wasmSection struct {
	ID    byte
	Start int
	End   int
	Name  string
	Data  []byte
}

type typeRefSpec struct {
	SchemaName     string
	FileIdentifier string
}

type entrySpec struct {
	EntryID         string
	Role            modulefb.ModuleBundleEntryRole
	SectionName     string
	PayloadEncoding modulefb.ModulePayloadEncoding
	MediaType       string
	TypeRef         *typeRefSpec
	Payload         []byte
	PayloadSHA256   []byte
	Description     string
}

type createInputs struct {
	BaseWasm             []byte
	ManifestPayload      []byte
	AuthorizationPayload []byte
	SignaturePayload     []byte
	TransportPayload     []byte
	AuxiliaryPayload     []byte
}

type typeRefSummary struct {
	SchemaName     string `json:"schemaName"`
	FileIdentifier string `json:"fileIdentifier"`
}

type entrySummary struct {
	EntryID                 string          `json:"entryId"`
	Role                    string          `json:"role"`
	PayloadEncoding         string          `json:"payloadEncoding"`
	SectionName             string          `json:"sectionName"`
	PayloadLength           int             `json:"payloadLength"`
	PayloadSHA256Hex        string          `json:"payloadSha256Hex"`
	TypeRef                 *typeRefSummary `json:"typeRef"`
	DecodedPayload          any             `json:"decodedPayload"`
	DecodedManifestPluginID *string         `json:"decodedManifestPluginId"`
}

type summary struct {
	BundleSectionName      string         `json:"bundleSectionName"`
	BaseModuleSHA256Hex    string         `json:"baseModuleSha256Hex"`
	BundleSHA256Hex        string         `json:"bundleSha256Hex"`
	BundledModuleSHA256Hex string         `json:"bundledModuleSha256Hex"`
	CanonicalModuleHashHex string         `json:"canonicalModuleHashHex"`
	ManifestHashHex        string         `json:"manifestHashHex"`
	ManifestPluginID       *string        `json:"manifestPluginId"`
	EntryIDs               []string       `json:"entryIds"`
	Entries                []entrySummary `json:"entries"`
}

func vectorsDir() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return filepath.Clean(filepath.Join("..", "..", "..", "..", "vectors"))
	}
	return filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "..", "..", "vectors"))
}

func readBytes(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func readCanonicalJSON(filename string) ([]byte, error) {
	data, err := readBytes(filepath.Join(vectorsDir(), filename))
	if err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(data, []byte("\n")), nil
}

func copyBytes(data []byte) []byte {
	if len(data) == 0 {
		return nil
	}
	cloned := make([]byte, len(data))
	copy(cloned, data)
	return cloned
}

func sha256Bytes(data []byte) []byte {
	hash := sha256.Sum256(data)
	return hash[:]
}

func sha256Hex(data []byte) string {
	return hex.EncodeToString(sha256Bytes(data))
}

func bytesHex(data []byte) string {
	return hex.EncodeToString(data)
}

func encodeULEB128(value int) []byte {
	if value < 0 {
		panic("ULEB128 only supports non-negative integers")
	}
	out := make([]byte, 0, 8)
	remaining := value
	for {
		b := byte(remaining & 0x7f)
		remaining >>= 7
		if remaining != 0 {
			b |= 0x80
		}
		out = append(out, b)
		if remaining == 0 {
			return out
		}
	}
}

func decodeULEB128(data []byte, offset int) (int, int, error) {
	result := 0
	shift := 0
	cursor := offset
	for cursor < len(data) {
		b := data[cursor]
		cursor++
		result |= int(b&0x7f) << shift
		if (b & 0x80) == 0 {
			return result, cursor, nil
		}
		shift += 7
	}
	return 0, 0, fmt.Errorf("unexpected EOF while decoding ULEB128")
}

func parseWasmSections(wasm []byte) ([]wasmSection, error) {
	if len(wasm) < 8 {
		return nil, fmt.Errorf("wasm module is truncated")
	}
	if !bytes.Equal(wasm[:4], wasmMagic) || !bytes.Equal(wasm[4:8], wasmVersion) {
		return nil, fmt.Errorf("invalid wasm header")
	}
	sections := make([]wasmSection, 0, 8)
	offset := 8
	for offset < len(wasm) {
		start := offset
		sectionID := wasm[offset]
		offset++
		size, nextOffset, err := decodeULEB128(wasm, offset)
		if err != nil {
			return nil, err
		}
		payloadStart := nextOffset
		payloadEnd := payloadStart + size
		if payloadEnd > len(wasm) {
			return nil, fmt.Errorf("wasm section extends past end of file")
		}
		section := wasmSection{
			ID:    sectionID,
			Start: start,
			End:   payloadEnd,
		}
		if sectionID == 0 {
			nameLength, nameStart, err := decodeULEB128(wasm, payloadStart)
			if err != nil {
				return nil, err
			}
			nameEnd := nameStart + nameLength
			if nameEnd > payloadEnd {
				return nil, fmt.Errorf("custom section name extends past payload")
			}
			section.Name = string(wasm[nameStart:nameEnd])
			section.Data = copyBytes(wasm[nameEnd:payloadEnd])
		}
		sections = append(sections, section)
		offset = payloadEnd
	}
	return sections, nil
}

func stripCustomSections(wasm []byte, prefix string) ([]byte, error) {
	sections, err := parseWasmSections(wasm)
	if err != nil {
		return nil, err
	}
	out := make([]byte, 0, len(wasm))
	out = append(out, wasm[:8]...)
	for _, section := range sections {
		if section.ID == 0 && bytes.HasPrefix([]byte(section.Name), []byte(prefix)) {
			continue
		}
		out = append(out, wasm[section.Start:section.End]...)
	}
	return out, nil
}

func appendCustomSection(wasm []byte, name string, payload []byte) []byte {
	nameBytes := []byte(name)
	content := make([]byte, 0, len(nameBytes)+len(payload)+8)
	content = append(content, encodeULEB128(len(nameBytes))...)
	content = append(content, nameBytes...)
	content = append(content, payload...)
	out := make([]byte, 0, len(wasm)+len(content)+8)
	out = append(out, wasm...)
	out = append(out, 0)
	out = append(out, encodeULEB128(len(content))...)
	out = append(out, content...)
	return out
}

func buildTypeRef(builder *flatbuffers.Builder, spec *typeRefSpec) flatbuffers.UOffsetT {
	if spec == nil {
		return 0
	}
	schemaName := builder.CreateString(spec.SchemaName)
	fileIdentifier := builder.CreateString(spec.FileIdentifier)
	streamfb.FlatBufferTypeRefStart(builder)
	streamfb.FlatBufferTypeRefAddSchemaName(builder, schemaName)
	streamfb.FlatBufferTypeRefAddFileIdentifier(builder, fileIdentifier)
	streamfb.FlatBufferTypeRefAddAcceptsAnyFlatbuffer(builder, false)
	return streamfb.FlatBufferTypeRefEnd(builder)
}

func buildEntry(builder *flatbuffers.Builder, entry entrySpec) flatbuffers.UOffsetT {
	entryID := builder.CreateString(entry.EntryID)
	sectionName := builder.CreateString(entry.SectionName)
	var mediaType flatbuffers.UOffsetT
	if entry.MediaType != "" {
		mediaType = builder.CreateString(entry.MediaType)
	}
	var description flatbuffers.UOffsetT
	if entry.Description != "" {
		description = builder.CreateString(entry.Description)
	}
	typeRef := buildTypeRef(builder, entry.TypeRef)
	shaOffset := builder.CreateByteVector(entry.PayloadSHA256)
	payloadOffset := builder.CreateByteVector(entry.Payload)
	modulefb.ModuleBundleEntryStart(builder)
	modulefb.ModuleBundleEntryAddEntryId(builder, entryID)
	modulefb.ModuleBundleEntryAddRole(builder, entry.Role)
	modulefb.ModuleBundleEntryAddSectionName(builder, sectionName)
	if typeRef != 0 {
		modulefb.ModuleBundleEntryAddTypeRef(builder, typeRef)
	}
	modulefb.ModuleBundleEntryAddPayloadEncoding(builder, entry.PayloadEncoding)
	if mediaType != 0 {
		modulefb.ModuleBundleEntryAddMediaType(builder, mediaType)
	}
	modulefb.ModuleBundleEntryAddFlags(builder, 0)
	modulefb.ModuleBundleEntryAddSha256(builder, shaOffset)
	modulefb.ModuleBundleEntryAddPayload(builder, payloadOffset)
	if description != 0 {
		modulefb.ModuleBundleEntryAddDescription(builder, description)
	}
	return modulefb.ModuleBundleEntryEnd(builder)
}

func loadCreationInputs() (*createInputs, error) {
	baseWasm, err := readBytes(filepath.Join(vectorsDir(), "base-module.wasm"))
	if err != nil {
		return nil, err
	}
	manifestPayload, err := readBytes(filepath.Join(vectorsDir(), "manifest.fb"))
	if err != nil {
		return nil, err
	}
	authorizationPayload, err := readCanonicalJSON("authorization.canonical.json")
	if err != nil {
		return nil, err
	}
	signaturePayload, err := readCanonicalJSON("signature.canonical.json")
	if err != nil {
		return nil, err
	}
	transportPayload, err := readCanonicalJSON("transport.canonical.json")
	if err != nil {
		return nil, err
	}
	auxiliaryPayload, err := readBytes(filepath.Join(vectorsDir(), "auxiliary.bin"))
	if err != nil {
		return nil, err
	}
	return &createInputs{
		BaseWasm:             baseWasm,
		ManifestPayload:      manifestPayload,
		AuthorizationPayload: authorizationPayload,
		SignaturePayload:     signaturePayload,
		TransportPayload:     transportPayload,
		AuxiliaryPayload:     auxiliaryPayload,
	}, nil
}

func createBundleArtifacts() ([]byte, []byte, []byte, error) {
	inputs, err := loadCreationInputs()
	if err != nil {
		return nil, nil, nil, err
	}
	baseWasm, err := stripCustomSections(inputs.BaseWasm, sdsCustomSectionPrefix)
	if err != nil {
		return nil, nil, nil, err
	}
	canonicalModuleHash := sha256Bytes(baseWasm)
	manifestHash := sha256Bytes(inputs.ManifestPayload)
	entries := []entrySpec{
		{
			EntryID:         "manifest",
			Role:            modulefb.ModuleBundleEntryRoleMANIFEST,
			SectionName:     "sds.manifest",
			PayloadEncoding: modulefb.ModulePayloadEncodingFLATBUFFER,
			TypeRef: &typeRefSpec{
				SchemaName:     "PluginManifest.fbs",
				FileIdentifier: "PMAN",
			},
			Payload:       inputs.ManifestPayload,
			PayloadSHA256: sha256Bytes(inputs.ManifestPayload),
			Description:   "Canonical plugin manifest.",
		},
		{
			EntryID:         "authorization",
			Role:            modulefb.ModuleBundleEntryRoleAUTHORIZATION,
			SectionName:     "sds.authorization",
			PayloadEncoding: modulefb.ModulePayloadEncodingJSON_UTF8,
			MediaType:       "application/json",
			Payload:         inputs.AuthorizationPayload,
			PayloadSHA256:   sha256Bytes(inputs.AuthorizationPayload),
			Description:     "Deployment authorization envelope.",
		},
		{
			EntryID:         "signature",
			Role:            modulefb.ModuleBundleEntryRoleSIGNATURE,
			SectionName:     "sds.signature",
			PayloadEncoding: modulefb.ModulePayloadEncodingJSON_UTF8,
			MediaType:       "application/json",
			Payload:         inputs.SignaturePayload,
			PayloadSHA256:   sha256Bytes(inputs.SignaturePayload),
			Description:     "Detached signature payload.",
		},
		{
			EntryID:         "transport",
			Role:            modulefb.ModuleBundleEntryRoleTRANSPORT,
			SectionName:     "sds.transport",
			PayloadEncoding: modulefb.ModulePayloadEncodingJSON_UTF8,
			MediaType:       "application/json",
			Payload:         inputs.TransportPayload,
			PayloadSHA256:   sha256Bytes(inputs.TransportPayload),
			Description:     "Transport envelope metadata.",
		},
		{
			EntryID:         "auxiliary-note",
			Role:            modulefb.ModuleBundleEntryRoleAUXILIARY,
			SectionName:     "sds.auxiliary",
			PayloadEncoding: modulefb.ModulePayloadEncodingRAW_BYTES,
			MediaType:       "application/octet-stream",
			Payload:         inputs.AuxiliaryPayload,
			PayloadSHA256:   sha256Bytes(inputs.AuxiliaryPayload),
			Description:     "Opaque auxiliary bytes for cross-language round-trip tests.",
		},
	}

	builder := flatbuffers.NewBuilder(4096)
	entryOffsets := make([]flatbuffers.UOffsetT, len(entries))
	for i := len(entries) - 1; i >= 0; i-- {
		entryOffsets[i] = buildEntry(builder, entries[i])
	}
	modulefb.ModuleBundleStartEntriesVector(builder, len(entryOffsets))
	for i := len(entryOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(entryOffsets[i])
	}
	entriesVector := builder.EndVector(len(entryOffsets))

	strippedPrefix := builder.CreateString(sdsCustomSectionPrefix)
	bundleSectionName := builder.CreateString(sdsBundleSectionName)
	hashAlgorithm := builder.CreateString("sha256")
	modulefb.CanonicalizationRuleStart(builder)
	modulefb.CanonicalizationRuleAddVersion(builder, 1)
	modulefb.CanonicalizationRuleAddStrippedCustomSectionPrefix(builder, strippedPrefix)
	modulefb.CanonicalizationRuleAddBundleSectionName(builder, bundleSectionName)
	modulefb.CanonicalizationRuleAddHashAlgorithm(builder, hashAlgorithm)
	canonicalization := modulefb.CanonicalizationRuleEnd(builder)

	canonicalModuleHashOffset := builder.CreateByteVector(canonicalModuleHash)
	manifestHashOffset := builder.CreateByteVector(manifestHash)
	moduleFormat := builder.CreateString(defaultModuleFormat)
	manifestExportSymbol := builder.CreateString(defaultManifestExportSymbol)
	manifestSizeSymbol := builder.CreateString(defaultManifestSizeSymbol)

	modulefb.ModuleBundleStart(builder)
	modulefb.ModuleBundleAddBundleVersion(builder, 1)
	modulefb.ModuleBundleAddModuleFormat(builder, moduleFormat)
	modulefb.ModuleBundleAddCanonicalization(builder, canonicalization)
	modulefb.ModuleBundleAddCanonicalModuleHash(builder, canonicalModuleHashOffset)
	modulefb.ModuleBundleAddManifestHash(builder, manifestHashOffset)
	modulefb.ModuleBundleAddManifestExportSymbol(builder, manifestExportSymbol)
	modulefb.ModuleBundleAddManifestSizeSymbol(builder, manifestSizeSymbol)
	modulefb.ModuleBundleAddEntries(builder, entriesVector)
	bundle := modulefb.ModuleBundleEnd(builder)
	modulefb.FinishModuleBundleBuffer(builder, bundle)
	bundleBytes := copyBytes(builder.FinishedBytes())
	bundledWasm := appendCustomSection(baseWasm, sdsBundleSectionName, bundleBytes)
	return baseWasm, bundleBytes, bundledWasm, nil
}

func stringPointer(value string) *string {
	return &value
}

func decodeJSONPayload(payload []byte) (any, error) {
	var out any
	if err := json.Unmarshal(payload, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func rawBytesAsInts(payload []byte) []int {
	values := make([]int, len(payload))
	for index, b := range payload {
		values[index] = int(b)
	}
	return values
}

func buildSummary(baseWasm, bundleBytes, bundledWasm []byte) (*summary, error) {
	if !modulefb.ModuleBundleBufferHasIdentifier(bundleBytes) {
		return nil, fmt.Errorf("module bundle buffer identifier mismatch")
	}
	bundle := modulefb.GetRootAsModuleBundle(bundleBytes, 0)
	var canonicalization modulefb.CanonicalizationRule
	if bundle.Canonicalization(&canonicalization) == nil {
		return nil, fmt.Errorf("bundle is missing canonicalization data")
	}

	entriesSummary := make([]entrySummary, 0, bundle.EntriesLength())
	entryIDs := make([]string, 0, bundle.EntriesLength())
	var manifestPluginID *string
	var entry modulefb.ModuleBundleEntry
	for index := 0; index < bundle.EntriesLength(); index++ {
		if !bundle.Entries(&entry, index) {
			return nil, fmt.Errorf("failed to decode entry %d", index)
		}
		entryID := string(entry.EntryId())
		entryIDs = append(entryIDs, entryID)
		payload := copyBytes(entry.PayloadBytes())
		payloadSHA256 := copyBytes(entry.Sha256Bytes())
		payloadEncoding := entry.PayloadEncoding()

		var decodedPayload any
		switch payloadEncoding {
		case modulefb.ModulePayloadEncodingJSON_UTF8:
			decoded, err := decodeJSONPayload(payload)
			if err != nil {
				return nil, err
			}
			decodedPayload = decoded
		case modulefb.ModulePayloadEncodingRAW_BYTES:
			decodedPayload = rawBytesAsInts(payload)
		}

		var typeRefSummaryValue *typeRefSummary
		var typeRef streamfb.FlatBufferTypeRef
		if entry.TypeRef(&typeRef) != nil {
			typeRefSummaryValue = &typeRefSummary{
				SchemaName:     string(typeRef.SchemaName()),
				FileIdentifier: string(typeRef.FileIdentifier()),
			}
		}

		var decodedManifestPluginID *string
		if entryID == "manifest" {
			manifest := manifestfb.GetRootAsPluginManifest(payload, 0)
			pluginID := string(manifest.PluginId())
			manifestPluginID = stringPointer(pluginID)
			decodedManifestPluginID = stringPointer(pluginID)
		}

		entriesSummary = append(entriesSummary, entrySummary{
			EntryID:                 entryID,
			Role:                    roleNames[entry.Role()],
			PayloadEncoding:         payloadEncodingNames[payloadEncoding],
			SectionName:             string(entry.SectionName()),
			PayloadLength:           len(payload),
			PayloadSHA256Hex:        bytesHex(payloadSHA256),
			TypeRef:                 typeRefSummaryValue,
			DecodedPayload:          decodedPayload,
			DecodedManifestPluginID: decodedManifestPluginID,
		})
	}

	return &summary{
		BundleSectionName:      string(canonicalization.BundleSectionName()),
		BaseModuleSHA256Hex:    sha256Hex(baseWasm),
		BundleSHA256Hex:        sha256Hex(bundleBytes),
		BundledModuleSHA256Hex: sha256Hex(bundledWasm),
		CanonicalModuleHashHex: bytesHex(bundle.CanonicalModuleHashBytes()),
		ManifestHashHex:        bytesHex(bundle.ManifestHashBytes()),
		ManifestPluginID:       manifestPluginID,
		EntryIDs:               entryIDs,
		Entries:                entriesSummary,
	}, nil
}

func commandParse(bundlePath string) error {
	bundledWasm, err := readBytes(bundlePath)
	if err != nil {
		return err
	}
	sections, err := parseWasmSections(bundledWasm)
	if err != nil {
		return err
	}
	var bundleBytes []byte
	for _, section := range sections {
		if section.ID == 0 && section.Name == sdsBundleSectionName {
			if bundleBytes != nil {
				return fmt.Errorf("expected exactly one sds.bundle section")
			}
			bundleBytes = copyBytes(section.Data)
		}
	}
	if bundleBytes == nil {
		return fmt.Errorf("expected exactly one sds.bundle section")
	}
	baseWasm, err := stripCustomSections(bundledWasm, sdsCustomSectionPrefix)
	if err != nil {
		return err
	}
	summaryValue, err := buildSummary(baseWasm, bundleBytes, bundledWasm)
	if err != nil {
		return err
	}
	output, err := json.MarshalIndent(summaryValue, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	return nil
}

func commandCreate(outputDir string) error {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}
	baseWasm, bundleBytes, bundledWasm, err := createBundleArtifacts()
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outputDir, "bundle.fb"), bundleBytes, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(outputDir, "single-file-module.wasm"), bundledWasm, 0o644); err != nil {
		return err
	}
	summaryValue, err := buildSummary(baseWasm, bundleBytes, bundledWasm)
	if err != nil {
		return err
	}
	output, err := json.MarshalIndent(summaryValue, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(output))
	return nil
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "Usage: go run ./cmd/reference_bundle parse <single-file-module.wasm> | create <output-dir>")
		os.Exit(1)
	}
	var err error
	switch os.Args[1] {
	case "parse":
		err = commandParse(os.Args[2])
	case "create":
		err = commandCreate(os.Args[2])
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
