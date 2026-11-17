// tests/test-utils/amazon-live-mpd.js
// Shared fixtures for the rendition-group refusal work.

// Real getDashManifestsV2 answer for ASIN B073N6C5XH, captured on the Linux
// dev-VMP build (2026-11, the three-consecutive-tracks capture): the FULL
// three-set answer — HD (flac, KID-1bc225), SD (opus x3, KID-5b47b9), LD
// (opus x2, KID-e4c4a7) — every set tagged <SupplementalProperty
// schemeIdUri="amz-music:trackType">, one Widevine key group per set. Only
// the segment lists are trimmed (two <SegmentURL> entries per Representation)
// and the BaseURLs are SCRUBBED: the host, the path and the per-session r=
// grant are placeholders (the capture's were session-scoped CDN URLs), while
// the ql= quality-level markers stay (they are the evidence the group label
// names a tier — LD_LOW/SD_MEDIUM/HD_44); Period@id, the two
// ContentProtection entries with cenc:pssh, AudioChannelConfiguration,
// SegmentList and every attribute order are verbatim from the capture.
module.exports.AMAZON_LIVE_MPD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<MPD minBufferTime="PT2S" type="static" mediaPresentationDuration="PT287.9333190917969S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:amz-music="urn:amazon:music:drm:2019" xmlns:cenc="urn:mpeg:cenc:2013" xmlns:mspr="urn:microsoft:playready">
    <Period id="0">
        <AdaptationSet id="1" contentType="audio" selectionPriority="2000">
            <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="1bc225a9-c9e0-7040-0cfd-5872162f30b1" value="cenc"/>
            <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">
                <cenc:pssh>AAAAXXBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAD0SEBvCJanJ4HBADP1YchYvMLEaC0FtYXpvbk11c2ljIhxjaWQ6RzhJbHFjbmdjRUFNL1ZoeUZpOHdzUT09</cenc:pssh>
            </ContentProtection>
            <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:ProgramLoudness" value="-9.4 LUFS"/>
            <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
            <SupplementalProperty schemeIdUri="urn:mpeg:dash:adaptation-set-switching:2016" value="2"/>
            <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:AnchorLoudness" value="-7.2 LUFS"/>
            <Representation id="1" qualityRanking="4" codecs="flac" audioSamplingRate="44100" bandwidth="1144652" mimeType="audio/mp4">
                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
                <SupplementalProperty schemeIdUri="amz-music:bitDepth" value="16"/>
                <BaseURL>https://cdn-placeholder.example.com/47734e46-placeholder/77d2185a-d380-3770-8a29-798bcb03c0ee.mp4?r=00000000-0000-0000-0000-000000000000&amp;rs=NA&amp;mt=US&amp;ql=HD_44&amp;dtype=A16ZV8BU3SN1N3</BaseURL>
                <SegmentList timescale="44100" duration="441000">
                    <Initialization range="0-1055"/>
                    <SegmentURL mediaRange="1436-1006581"/>
                    <SegmentURL mediaRange="1006582-2084809"/>
                </SegmentList>
            </Representation>
        </AdaptationSet>
        <AdaptationSet id="2" contentType="audio" selectionPriority="1000">
            <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="5b47b909-10c5-c8e0-8c27-1d0d17cb1e3c" value="cenc"/>
            <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">
                <cenc:pssh>AAAAXXBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAD0SEFtHuQkQxcjgjCcdDRfLHjwaC0FtYXpvbk11c2ljIhxjaWQ6VzBlNUNSREZ5T0NNSngwTkY4c2VQQT09</cenc:pssh>
            </ContentProtection>
            <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:ProgramLoudness" value="-9.4 LUFS"/>
            <SupplementalProperty schemeIdUri="amz-music:trackType" value="SD"/>
            <SupplementalProperty schemeIdUri="urn:mpeg:dash:adaptation-set-switching:2016" value="1"/>
            <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:AnchorLoudness" value="-7.2 LUFS"/>
            <Representation id="2" qualityRanking="3" codecs="opus" audioSamplingRate="48000" bandwidth="52988" mimeType="audio/mp4">
                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
                <BaseURL>https://cdn-placeholder.example.com/47734e46-placeholder/6ee6e32d-4be2-3335-8ed1-48702c23d8fe.mp4?r=00000000-0000-0000-0000-000000000000&amp;rs=NA&amp;mt=US&amp;ql=SD_LOW&amp;dtype=A16ZV8BU3SN1N3</BaseURL>
                <SegmentList timescale="48000" duration="480000">
                    <Initialization range="0-1019"/>
                    <SegmentURL mediaRange="1400-61655"/>
                    <SegmentURL mediaRange="61656-121791"/>
                </SegmentList>
            </Representation>
            <Representation id="3" qualityRanking="2" codecs="opus" audioSamplingRate="48000" bandwidth="196992" mimeType="audio/mp4">
                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
                <BaseURL>https://cdn-placeholder.example.com/47734e46-placeholder/66a7f2e2-6d00-3da8-a26c-2d1621a914e8.mp4?r=00000000-0000-0000-0000-000000000000&amp;rs=NA&amp;mt=US&amp;ql=SD_MEDIUM&amp;dtype=A16ZV8BU3SN1N3</BaseURL>
                <SegmentList timescale="48000" duration="480000">
                    <Initialization range="0-1019"/>
                    <SegmentURL mediaRange="1400-242015"/>
                    <SegmentURL mediaRange="242016-482151"/>
                </SegmentList>
            </Representation>
            <Representation id="4" qualityRanking="1" codecs="opus" audioSamplingRate="48000" bandwidth="324994" mimeType="audio/mp4">
                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
                <BaseURL>https://cdn-placeholder.example.com/47734e46-placeholder/aaf33924-0ca0-3899-b4ae-9a6ec966d84f.mp4?r=00000000-0000-0000-0000-000000000000&amp;rs=NA&amp;mt=US&amp;ql=SD_HIGH&amp;dtype=A16ZV8BU3SN1N3</BaseURL>
                <SegmentList timescale="48000" duration="480000">
                    <Initialization range="0-1019"/>
                    <SegmentURL mediaRange="1400-402335"/>
                    <SegmentURL mediaRange="402336-802471"/>
                </SegmentList>
            </Representation>
        </AdaptationSet>
        <AdaptationSet id="3" contentType="audio" selectionPriority="500">
            <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="e4c4a767-2219-7ab4-7f3b-832932733894" value="cenc"/>
            <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">
                <cenc:pssh>AAAAXXBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAAD0SEOTEp2ciGXq0fzuDKTJzOJQaC0FtYXpvbk11c2ljIhxjaWQ6NU1Tblp5SVplclIvTzRNcE1uTTRsQT09</cenc:pssh>
            </ContentProtection>
            <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:ProgramLoudness" value="-9.4 LUFS"/>
            <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
            <SupplementalProperty schemeIdUri="urn:mpeg:mpegB:cicp:AnchorLoudness" value="-7.2 LUFS"/>
            <Representation id="5" qualityRanking="2000" codecs="opus" audioSamplingRate="48000" bandwidth="52988" mimeType="audio/mp4">
                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
                <BaseURL>https://cdn-placeholder.example.com/47734e46-placeholder/efcaef5b-7613-3bab-8e48-60ba33b8578b.mp4?r=00000000-0000-0000-0000-000000000000&amp;rs=NA&amp;mt=US&amp;ql=LD_LOW&amp;dtype=A16ZV8BU3SN1N3</BaseURL>
                <SegmentList timescale="48000" duration="480000">
                    <Initialization range="0-1019"/>
                    <SegmentURL mediaRange="1400-61655"/>
                    <SegmentURL mediaRange="61656-121791"/>
                </SegmentList>
            </Representation>
            <Representation id="6" qualityRanking="1000" codecs="opus" audioSamplingRate="48000" bandwidth="164991" mimeType="audio/mp4">
                <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
                <BaseURL>https://cdn-placeholder.example.com/47734e46-placeholder/e8d3d35e-1f23-3109-b223-67d45b6e8f06.mp4?r=00000000-0000-0000-0000-000000000000&amp;rs=NA&amp;mt=US&amp;ql=LD_MEDIUM&amp;dtype=A16ZV8BU3SN1N3</BaseURL>
                <SegmentList timescale="48000" duration="480000">
                    <Initialization range="0-1019"/>
                    <SegmentURL mediaRange="1400-201935"/>
                    <SegmentURL mediaRange="201936-402071"/>
                </SegmentList>
            </Representation>
        </AdaptationSet>
    </Period>
</MPD>
`;

// A SYNTHESIZED five-set shape (not a capture): the SET COUNT and the rung
// bandwidths follow a 2026-10 Ultra-HD-account observation (five sets /
// nine renditions — two FLAC rungs riding two sets, a spatial rung of its
// own), but no amz-music:trackType data was observed for that capture — the
// LD/SD/HD labels on the first three sets are carried over from the three-set
// live shape above, and the SECOND FLAC set's and the spatial set's labels
// are GUESSES. It exists to pin one rule only: two sets sharing value="HD"
// drop together and report ONCE (mpdDropRenditionGroups drops a TIER), and a
// different tier stays — family-scoping the cache was considered and rejected
// (see mpdDropRenditionGroups).
module.exports.AMAZON_SYNTHESIZED_FIVE_SET_MPD = `<MPD minBufferTime="PT2S"><Period id="0">
  <AdaptationSet id="1" contentType="audio" selectionPriority="500">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="00000000-0001-0000-0000-000000000000" value="cenc"/>
    <Representation id="1" codecs="opus" bandwidth="53059" mimeType="audio/mp4"/>
  </AdaptationSet>
  <AdaptationSet id="2" contentType="audio" selectionPriority="1000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="SD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="00000000-0002-0000-0000-000000000000" value="cenc"/>
    <Representation id="2" codecs="opus" bandwidth="197343" mimeType="audio/mp4"/>
    <Representation id="3" codecs="opus" bandwidth="325595" mimeType="audio/mp4"/>
  </AdaptationSet>
  <AdaptationSet id="3" contentType="audio" selectionPriority="2000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="00000000-0003-0000-0000-000000000000" value="cenc"/>
    <Representation id="4" codecs="flac" bandwidth="1062133" mimeType="audio/mp4"/>
  </AdaptationSet>
  <AdaptationSet id="4" contentType="audio" selectionPriority="2100">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="00000000-0004-0000-0000-000000000000" value="cenc"/>
    <Representation id="5" codecs="flac" bandwidth="1902230" mimeType="audio/mp4"/>
  </AdaptationSet>
  <AdaptationSet id="5" contentType="audio" selectionPriority="3000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="SPATIAL_ATMOS_HIGH"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" cenc:default_KID="00000000-0005-0000-0000-000000000000" value="cenc"/>
    <Representation id="6" codecs="ec-3" bandwidth="770130" mimeType="audio/mp4"/>
  </AdaptationSet>
</Period></MPD>`;
